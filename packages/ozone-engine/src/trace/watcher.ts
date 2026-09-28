/**
 * Watcher for new hack money arriving at THORChain.
 *
 * Hack proceeds rarely reach THORChain straight from an attributed address:
 * launderers fund fresh addresses first. For every new THORChain inbound (a
 * swap or an add from an L1 address) of at least `minUsd` whose sender no
 * list or trace covers, the watcher looks back one or two hops on that L1
 * chain at who funded the sender. If a funder is listed (sanctions, an
 * incident, a hack cluster) or already traced, the depositor gets a traced
 * reason — "funded by <origin> one hop before THORChain" — and from then on
 * its THORChain outputs are traced like any traced address.
 *
 * - The real-time follower only enqueues (watchCandidates + enqueueWatch):
 *   a bounded insert, errors swallowed, so it is never slowed or stopped.
 * - A separate job works through the queue (processWatchQueue) within a
 *   time budget, through the same per-host budgets as the cluster expansion
 *   (explorers/budget.ts): a chain whose quota is spent waits for the next
 *   run, and a chain without any explorer is recorded as skipped.
 * - Cached by address: an address looked back within `cacheTtlMs` is not
 *   queued again, and funder lists are kept in oz_l1_funders.
 * - Services are skipped: a depositor or funder with more transactions than
 *   the page read in the window, a contract (aggregators, routers, smart
 *   wallets), or a UTXO transaction with many inputs or outputs (exchange
 *   batches), and CoinJoins.
 * - Metrics (queued, look-backs, hits, skips by reason and chain) are kept
 *   in oz_state `watch:metrics`.
 */
import { riskRank } from '../../../ozone-client/src/index.js';
import { QuotaExceeded } from '../explorers/budget.js';
import { evmCall, evmCapacity, evmContracts, evmProviders, evmTxList, isEvmChain, LATEST_BLOCK, NoExplorer, type EvmChain, type ExplorerEnv } from '../explorers/evm.js';
import { Esplora, isCoinJoin, isUtxoChain, type UtxoChain } from '../explorers/esplora.js';
import { getState, loadTraceIndex, recordHits, setState } from '../store/trace.js';
import { silentLogger, type Logger, type Sql } from '../types.js';
import type { HttpOptions } from '../util/http.js';
import { chainOfAsset, parseTxAddress, actionDate } from './flows.js';
import type { MidgardAction } from './midgard.js';
import type { PriceOracle } from './prices.js';
import { traceRisk, DEFAULT_TRACE_CONFIG, type IndexEntry, type TraceHit } from './tracer.js';

export interface WatchConfig {
	/** Smallest inbound (USD) that is looked back on. */
	minUsd: number;
	/** How far before the deposit funders count. */
	lookbackDays: number;
	/** 1: only direct funders; 2: also the funders of the largest funders. */
	hops: 1 | 2;
	/** Funders followed to the second hop (largest first). */
	maxFunders: number;
	/** An address looked back on is not looked back on again for this long. */
	cacheTtlMs: number;
	/** Candidates enqueued per real-time tick at most. */
	maxPerTick: number;
	/** Transactions read per address (more: a service, not followed). */
	pageSize: number;
	/** Pending rows older than this are dropped (recorded as skipped). */
	expireMs: number;
}

export const DEFAULT_WATCH_CONFIG: WatchConfig = {
	minUsd: 25_000,
	lookbackDays: 30,
	hops: 2,
	maxFunders: 3,
	cacheTtlMs: 7 * 24 * 3600_000,
	maxPerTick: 200,
	pageSize: 200,
	expireMs: 3 * 24 * 3600_000
};

/** Chains a look-back can run on (an explorer may still be missing: see evmProviders). */
export function isLookbackChain(chain: string): boolean {
	return isEvmChain(chain) || isUtxoChain(chain);
}

export interface WatchCandidate {
	key: string;
	chain: string;
	address: string;
	/** The L1 transaction of the inbound. */
	txid: string;
	height: number;
	date: string;
	usd: number;
	asset: string;
	action: string;
}

/**
 * Large inbounds from L1 addresses that no list or trace covers yet (pure).
 * Inbounds from THORChain itself (RUNE, trade/secured assets) are not L1
 * deposits and are left to the normal tracing.
 */
export function watchCandidates(
	actions: MidgardAction[],
	lookup: (key: string) => IndexEntry | undefined,
	prices: PriceOracle | undefined,
	cfg: WatchConfig = DEFAULT_WATCH_CONFIG
): WatchCandidate[] {
	const best = new Map<string, WatchCandidate>();
	for (const a of actions) {
		if (a.type !== 'swap' && a.type !== 'addLiquidity') continue;
		if (a.status === 'failed') continue;
		for (const t of a.in) {
			const coin = t.coins?.[0];
			if (!coin || /[~/]/.test(coin.asset) || /^[A-Z0-9]+-/.test(coin.asset)) continue; // trade / synth / secured: not an L1 inbound
			const chain = chainOfAsset(coin.asset);
			if (!chain || chain === 'THOR' || !isLookbackChain(chain)) continue;
			const p = parseTxAddress(t);
			if (!p || lookup(p.key)) continue; // already listed or traced: the normal tracing covers it
			const inPrice = Number(a.metadata?.swap?.inPriceUSD);
			const price = inPrice > 0 ? inPrice : prices?.priceUsd(coin.asset);
			if (!price) continue;
			const usd = (Number(coin.amount) / 1e8) * price;
			if (!(usd >= cfg.minUsd)) continue;
			const c: WatchCandidate = {
				key: p.key,
				chain,
				address: p.address,
				txid: String(t.txID ?? ''),
				height: Number(a.height),
				date: actionDate(a),
				usd,
				asset: coin.asset,
				action: a.type
			};
			const cur = best.get(c.key);
			if (!cur || c.usd > cur.usd) best.set(c.key, c);
		}
	}
	return [...best.values()].sort((x, y) => y.usd - x.usd);
}

/**
 * Queues candidates for a look-back. An address already pending, or looked
 * back on within the cache lifetime, is not queued again.
 */
export async function enqueueWatch(sql: Sql, candidates: WatchCandidate[], cfg: WatchConfig = DEFAULT_WATCH_CONFIG): Promise<{ queued: number }> {
	const list = candidates.slice(0, cfg.maxPerTick);
	if (!list.length) return { queued: 0 };
	const r = await sql.query<{ n: number }>(
		`WITH c AS (
		   SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::timestamptz[], $7::float8[], $8::text[], $9::text[])
		     AS t(key, chain, address, txid, height, ts, usd, asset, action)
		 ), ins AS (
		   INSERT INTO oz_watch_queue (key, chain, address, txid, height, ts, usd, asset, action)
		   SELECT key, chain, address, txid, height, ts, usd, asset, action FROM c
		   ON CONFLICT (key) DO UPDATE SET txid = EXCLUDED.txid, height = EXCLUDED.height, ts = EXCLUDED.ts, usd = EXCLUDED.usd,
		     asset = EXCLUDED.asset, action = EXCLUDED.action, status = 'pending', reason = NULL, attempts = 0, enqueued_at = now()
		   WHERE oz_watch_queue.status <> 'pending'
		     AND (oz_watch_queue.checked_at IS NULL OR oz_watch_queue.checked_at < now() - ($10::text || ' milliseconds')::interval)
		   RETURNING 1
		 )
		 SELECT count(*)::int AS n FROM ins`,
		[
			list.map((c) => c.key),
			list.map((c) => c.chain),
			list.map((c) => c.address),
			list.map((c) => c.txid),
			list.map((c) => c.height),
			list.map((c) => new Date(c.date)),
			list.map((c) => c.usd),
			list.map((c) => c.asset),
			list.map((c) => c.action),
			String(cfg.cacheTtlMs)
		]
	);
	const queued = r.rows[0]?.n ?? 0;
	if (queued) await bumpMetrics(sql, { enqueued: queued });
	return { queued };
}

interface Funder {
	address: string;
	key: string;
	chain: string;
	value: number;
	unit: string;
	tx: string;
	time: number;
}

interface FunderList {
	funders: Funder[];
	/** More activity than one page: a service, not followed. */
	service: boolean;
	requests: number;
}

const NATIVE: Record<string, string> = { ETH: 'ETH', ARB: 'ETH', OP: 'ETH', BASE: 'ETH', POL: 'POL', AVAX: 'AVAX', BSC: 'BNB', GNOSIS: 'xDAI', BTC: 'BTC', LTC: 'LTC' };

/** Token contract of a THORChain asset (`ETH.USDT-0XDAC1…` → 0xdac1…), if any. */
export function tokenContract(asset: string): string | undefined {
	const m = /-(0X[0-9A-F]{40})$/i.exec(asset);
	return m ? m[1].toLowerCase() : undefined;
}

interface TokenTx {
	from: string;
	to: string;
	value: string;
	hash: string;
	timeStamp: string;
	tokenDecimal?: string;
	tokenSymbol?: string;
}

/** Who sent `address` value (native coin, and the deposited token if any) in the window before `beforeUnix`, largest first. */
async function evmFunders(
	chain: EvmChain,
	address: string,
	beforeUnix: number,
	cfg: WatchConfig,
	o: { http?: HttpOptions; env?: ExplorerEnv; token?: string }
): Promise<FunderList> {
	const fromUnix = beforeUnix - cfg.lookbackDays * 86_400;
	const { txs, requests, more } = await evmTxList(chain, address, {
		startblock: 0,
		endblock: LATEST_BLOCK,
		direction: 'to',
		sort: 'desc',
		maxPages: 1,
		pageSize: cfg.pageSize,
		http: o.http,
		env: o.env
	});
	let req = requests;
	const sums = new Map<string, Funder>();
	const add = (from: string, value: number, unit: string, tx: string, time: number) => {
		if (!/^0x[0-9a-f]{40}$/.test(from) || from === address || value <= 0) return;
		const cur = sums.get(`${from}|${unit}`);
		if (cur) {
			cur.value += value;
			if (time < cur.time) {
				cur.time = time;
				cur.tx = tx;
			}
		} else sums.set(`${from}|${unit}`, { address: from, key: `evm:${from}`, chain, value, unit, tx, time });
	};
	for (const t of txs) {
		const time = Number(t.timeStamp);
		if (t.isError === '1' || time > beforeUnix || time < fromUnix) continue;
		add((t.from ?? '').toLowerCase(), Number(BigInt(t.value || '0') / 10n ** 12n) / 1e6, NATIVE[chain], t.hash, time);
	}
	let service = more;
	if (o.token) {
		const { result } = await evmCall<TokenTx[]>(
			chain,
			{ module: 'account', action: 'tokentx', contractaddress: o.token, address, startblock: 0, endblock: LATEST_BLOCK, sort: 'desc', page: 1, offset: cfg.pageSize },
			{ http: o.http, env: o.env }
		);
		req++;
		const list = Array.isArray(result) ? result : [];
		if (list.length >= cfg.pageSize) service = true;
		for (const t of list) {
			const time = Number(t.timeStamp);
			if ((t.to ?? '').toLowerCase() !== address || time > beforeUnix || time < fromUnix) continue;
			const dec = Number(t.tokenDecimal ?? 18);
			let v = 0;
			try {
				v = Number(BigInt(t.value)) / 10 ** dec;
			} catch {
				continue;
			}
			add((t.from ?? '').toLowerCase(), v, t.tokenSymbol || 'token', t.hash, time);
		}
	}
	return { funders: [...sums.values()].sort((a, b) => b.value - a.value || a.time - b.time), service, requests: req };
}

/**
 * Funders of a UTXO deposit: the other inputs of the deposit transaction
 * (spent together: the same owner) and the inputs of the transactions that
 * created the deposit's largest inputs.
 */
async function utxoFunders(esplora: Esplora, txid: string, address: string, cfg: WatchConfig): Promise<FunderList & { coinjoin: boolean; coSpenders: Funder[] }> {
	const chain = esplora.chain;
	const start = esplora.requests;
	const tx = await esplora.tx(txid.toLowerCase());
	const unit = NATIVE[chain];
	if (isCoinJoin(tx)) return { funders: [], coSpenders: [], service: false, coinjoin: true, requests: esplora.requests - start };
	if (tx.vin.length > 20 || tx.vout.length > 20) return { funders: [], coSpenders: [], service: true, coinjoin: false, requests: esplora.requests - start };
	const time = tx.status?.block_time ?? 0;
	const coSpenders: Funder[] = [];
	const own = new Set([address]);
	for (const v of tx.vin) {
		const a = v.prevout?.scriptpubkey_address;
		if (a && a !== address && !coSpenders.some((c) => c.address === a)) {
			coSpenders.push({ address: a, key: '', chain, value: (v.prevout?.value ?? 0) / 1e8, unit, tx: txid.toLowerCase(), time });
			own.add(a);
		}
	}
	const funders: Funder[] = [];
	const inputs = [...tx.vin].filter((v) => !v.is_coinbase).sort((a, b) => (b.prevout?.value ?? 0) - (a.prevout?.value ?? 0)).slice(0, cfg.maxFunders);
	for (const v of inputs) {
		const ftx = await esplora.tx(v.txid);
		for (const w of ftx.vin) {
			const a = w.prevout?.scriptpubkey_address;
			if (!a || own.has(a) || funders.some((f) => f.address === a)) continue;
			funders.push({ address: a, key: '', chain, value: (v.prevout?.value ?? 0) / 1e8, unit, tx: v.txid, time: ftx.status?.block_time ?? 0 });
		}
	}
	return { funders, coSpenders, service: false, coinjoin: false, requests: esplora.requests - start };
}

export interface WatchRunMetrics {
	lookbacks: number;
	hits: number;
	errors: number;
	requests: number;
	/** Still pending after this run. */
	pending: number;
	skipped: Record<string, number>;
	byChain: Record<string, { lookbacks: number; hits: number; skipped: number }>;
}

interface QueueRow {
	key: string;
	chain: string;
	address: string;
	txid: string | null;
	height: string | number | null;
	ts: string | Date | null;
	usd: number | null;
	asset: string | null;
	enqueued_at: string | Date;
}

async function bumpMetrics(sql: Sql, d: { enqueued?: number; lookbacks?: number; hits?: number; skipped?: number; errors?: number }, last?: WatchRunMetrics): Promise<void> {
	type Totals = { enqueued: number; lookbacks: number; hits: number; skipped: number; errors: number };
	const cur = (await getState<{ since: string; totals: Totals; days: Record<string, Totals>; last?: WatchRunMetrics & { at: string } }>(sql, 'watch:metrics')) ?? {
		since: new Date().toISOString(),
		totals: { enqueued: 0, lookbacks: 0, hits: 0, skipped: 0, errors: 0 },
		days: {}
	};
	const day = new Date().toISOString().slice(0, 10);
	const bucket = (cur.days[day] ??= { enqueued: 0, lookbacks: 0, hits: 0, skipped: 0, errors: 0 });
	for (const k of ['enqueued', 'lookbacks', 'hits', 'skipped', 'errors'] as const) {
		cur.totals[k] += d[k] ?? 0;
		bucket[k] += d[k] ?? 0;
	}
	cur.days = Object.fromEntries(Object.entries(cur.days).sort().slice(-14));
	if (last) cur.last = { ...last, at: new Date().toISOString() };
	await setState(sql, 'watch:metrics', cur);
}

/** The funder list of an address from the cache (fresh enough), or undefined. */
async function cachedFunders(sql: Sql, key: string, ttlMs: number): Promise<Funder[] | undefined> {
	const r = await sql.query<{ funders: Funder[] | string; checked_at: string | Date }>(`SELECT funders, checked_at FROM oz_l1_funders WHERE key = $1`, [key]);
	const row = r.rows[0];
	if (!row || Date.now() - new Date(row.checked_at).getTime() > ttlMs) return undefined;
	return typeof row.funders === 'string' ? JSON.parse(row.funders) : row.funders;
}

async function cacheFunders(sql: Sql, key: string, chain: string, funders: Funder[]): Promise<void> {
	await sql.query(
		`INSERT INTO oz_l1_funders (key, chain, checked_at, funders) VALUES ($1,$2,now(),$3)
		 ON CONFLICT (key) DO UPDATE SET chain = EXCLUDED.chain, checked_at = EXCLUDED.checked_at, funders = EXCLUDED.funders`,
		[key, chain, JSON.stringify(funders.slice(0, 50))]
	);
}

/** A funder's key as the index knows it (UTXO funders are parsed here). */
function withKey(f: Funder): Funder | undefined {
	if (f.key) return f;
	const p = parseTxAddress({ address: f.address, coins: [{ asset: `${f.chain}.${f.chain}`, amount: '0' }], txID: '' });
	return p ? { ...f, key: p.key, address: p.address } : undefined;
}

function hitFor(row: QueueRow, via: Funder, origin: IndexEntry, hops: 1 | 2, usd: number): TraceHit | undefined {
	const hop = origin.hop + hops;
	const risk = traceRisk(origin.originRisk, hop, usd, 'value', DEFAULT_TRACE_CONFIG);
	if (!risk) return undefined;
	const height = Number(row.height ?? 0);
	return {
		txid: via.tx,
		// the THORChain height just before the deposit: the depositor is traced from its deposit on
		height: height > 0 ? height - 1 : 0,
		date: new Date((via.time || Date.now() / 1000) * 1000).toISOString(),
		action: hops === 1 ? 'l1_funding' : 'l1_funding2',
		relation: 'value',
		fromKey: via.key,
		fromAddress: via.address,
		fromChain: via.chain,
		toKey: row.key,
		toAddress: row.address,
		toChain: row.chain,
		amount: `${Math.round(via.value * 1e6) / 1e6} ${via.unit}`,
		usd,
		hop,
		risk,
		originKey: origin.originKey,
		originSource: origin.originSource,
		...(origin.originEntity ? { originEntity: origin.originEntity } : {}),
		originRisk: origin.originRisk,
		originCategory: origin.originCategory
	};
}

/** The strongest flagged funder among `funders` (lowest hop, then highest risk). */
function strongest(funders: Funder[], lookup: (k: string) => IndexEntry | undefined): { f: Funder; e: IndexEntry } | undefined {
	let best: { f: Funder; e: IndexEntry } | undefined;
	for (const f0 of funders) {
		const f = withKey(f0);
		if (!f) continue;
		const e = lookup(f.key);
		if (!e || e.service) continue;
		if (!best || e.hop < best.e.hop || (e.hop === best.e.hop && riskRank(e.originRisk) > riskRank(best.e.originRisk))) best = { f, e };
	}
	return best;
}

export interface WatchOptions {
	cfg?: WatchConfig;
	http?: HttpOptions;
	env?: ExplorerEnv;
	logger?: Logger;
	/** Stop after this long (ms). */
	budgetMs?: number;
	/** Rows per run at most. */
	maxLookbacks?: number;
	/** The tracer's index (loaded when not given). */
	index?: Map<string, IndexEntry>;
	/** Esplora clients (tests). */
	esplora?: Partial<Record<UtxoChain, Esplora>>;
}

/**
 * Works through the look-back queue, largest deposits first, until the
 * budget is spent. Never throws for one row: its error is recorded on it.
 */
export async function processWatchQueue(sql: Sql, opts: WatchOptions = {}): Promise<WatchRunMetrics> {
	const cfg = opts.cfg ?? DEFAULT_WATCH_CONFIG;
	const log = opts.logger ?? silentLogger;
	const deadline = Date.now() + (opts.budgetMs ?? 45_000);
	const m: WatchRunMetrics = { lookbacks: 0, hits: 0, errors: 0, requests: 0, pending: 0, skipped: {}, byChain: {} };
	const chainM = (c: string) => (m.byChain[c] ??= { lookbacks: 0, hits: 0, skipped: 0 });
	const skip = (c: string, why: string) => {
		m.skipped[why] = (m.skipped[why] ?? 0) + 1;
		chainM(c).skipped++;
	};
	const expired = await sql.query<{ chain: string }>(
		`UPDATE oz_watch_queue SET status = 'skipped', reason = 'expired: no explorer capacity in time', checked_at = now()
		 WHERE status = 'pending' AND enqueued_at < now() - ($1::text || ' milliseconds')::interval RETURNING chain`,
		[String(cfg.expireMs)]
	);
	for (const r of expired.rows) skip(r.chain, 'expired');
	const rows = (
		await sql.query<QueueRow>(
			`SELECT key, chain, address, txid, height, ts, usd, asset, enqueued_at FROM oz_watch_queue WHERE status = 'pending'
			 ORDER BY usd DESC NULLS LAST, enqueued_at LIMIT $1`,
			[opts.maxLookbacks ?? 200]
		)
	).rows;
	if (!rows.length) return m;
	const index = opts.index ?? (await loadTraceIndex(sql));
	const lookup = (k: string) => index.get(k);
	const exhausted = new Set<string>();
	const clients: Partial<Record<UtxoChain, Esplora>> = opts.esplora ?? {};
	const esplora = (c: UtxoChain) => (clients[c] ??= new Esplora(c, { http: opts.http }));
	const finish = async (row: QueueRow, status: string, reason: string | null, result?: unknown) => {
		await sql.query(`UPDATE oz_watch_queue SET status = $2, reason = $3, result = $4, checked_at = now(), attempts = attempts + 1 WHERE key = $1`, [
			row.key,
			status,
			reason,
			result === undefined ? null : JSON.stringify(result)
		]);
	};
	for (const row of rows) {
		if (Date.now() > deadline) break;
		const chain = row.chain;
		if (exhausted.has(chain)) continue;
		if (lookup(row.key)) {
			await finish(row, 'done', 'listed or traced meanwhile');
			skip(chain, 'alreadyFlagged');
			continue;
		}
		if (isEvmChain(chain)) {
			if (!evmProviders(chain, opts.env).length) {
				await finish(row, 'skipped', `no explorer API for ${chain} (needs ETHERSCAN_API_KEY on a plan covering it, or BLOCKSCOUT_API_KEY)`);
				skip(chain, 'noExplorer');
				continue;
			}
			if (evmCapacity(chain, opts.env) <= 0) {
				exhausted.add(chain);
				skip(chain, 'quota');
				continue;
			}
		} else if (!isUtxoChain(chain)) {
			await finish(row, 'skipped', `no look-back for ${chain}`);
			skip(chain, 'noExplorer');
			continue;
		}
		const beforeUnix = Math.floor(new Date(row.ts ?? Date.now()).getTime() / 1000);
		const usd = Number(row.usd ?? 0);
		try {
			let hit: TraceHit | undefined;
			let detail: Record<string, unknown> = {};
			if (isEvmChain(chain)) {
				const direct = await evmFunders(chain, row.address, beforeUnix, cfg, { http: opts.http, env: opts.env, token: row.asset ? tokenContract(row.asset) : undefined });
				m.requests += direct.requests;
				await cacheFunders(sql, row.key, chain, direct.funders);
				// the depositor itself and its largest funders: contracts (aggregators, routers, bridges) are services
				const codes = await evmContracts(chain, [row.address, ...direct.funders.slice(0, cfg.maxFunders).map((f) => f.address)], { http: opts.http });
				if (direct.service || codes.get(row.address) === true) {
					await finish(row, 'skipped', direct.service ? 'service (busy address)' : 'contract depositor (aggregator, router or smart wallet)');
					skip(chain, direct.service ? 'service' : 'contract');
					m.lookbacks++;
					chainM(chain).lookbacks++;
					continue;
				}
				const one = strongest(direct.funders, lookup);
				if (one) hit = hitFor(row, one.f, one.e, 1, usd);
				if (!hit && cfg.hops === 2) {
					for (const f of direct.funders.filter((x) => codes.get(x.address) === false).slice(0, cfg.maxFunders)) {
						if (Date.now() > deadline) break;
						let second = await cachedFunders(sql, f.key, cfg.cacheTtlMs);
						if (!second) {
							const r2 = await evmFunders(chain, f.address, f.time || beforeUnix, cfg, { http: opts.http, env: opts.env });
							m.requests += r2.requests;
							if (r2.service) continue; // an exchange or other service funded it: not followed
							second = r2.funders;
							await cacheFunders(sql, f.key, chain, second);
						}
						const two = strongest(second, lookup);
						if (two) {
							hit = hitFor(row, f, two.e, 2, usd);
							detail = { via: f.address, origin: two.f.address };
							if (hit) break;
						}
					}
				}
				detail = { ...detail, funders: direct.funders.length };
			} else {
				const client = esplora(chain as UtxoChain);
				if (!row.txid) {
					await finish(row, 'skipped', 'no L1 transaction id');
					skip(chain, 'noTxid');
					continue;
				}
				const r = await utxoFunders(client, row.txid, row.address, cfg);
				m.requests += r.requests;
				if (r.coinjoin || r.service) {
					await finish(row, 'skipped', r.coinjoin ? 'CoinJoin deposit' : 'service (batched transaction)');
					skip(chain, r.coinjoin ? 'coinjoin' : 'service');
					m.lookbacks++;
					chainM(chain).lookbacks++;
					continue;
				}
				// spent together with the deposit: the same owner, so it counts like a direct funder
				const one = strongest([...r.coSpenders, ...r.funders], lookup);
				if (one) hit = hitFor(row, one.f, one.e, 1, usd);
				await cacheFunders(sql, row.key, chain, [...r.coSpenders, ...r.funders].map((f) => withKey(f)).filter((f): f is Funder => !!f));
				if (!hit && cfg.hops === 2) {
					for (const f of r.funders.slice(0, Math.min(2, cfg.maxFunders))) {
						if (Date.now() > deadline) break;
						const second = await utxoFunders(client, f.tx, f.address, { ...cfg, maxFunders: 1 }).catch(() => undefined);
						if (!second) continue;
						m.requests += second.requests;
						const two = strongest([...second.coSpenders, ...second.funders], lookup);
						const via = withKey(f);
						if (two && via) {
							hit = hitFor(row, via, two.e, 2, usd);
							detail = { via: f.address, origin: two.f.address };
							if (hit) break;
						}
					}
				}
				detail = { ...detail, funders: r.funders.length, coSpenders: r.coSpenders.length };
			}
			m.lookbacks++;
			chainM(chain).lookbacks++;
			if (hit) {
				await recordHits(sql, [hit]);
				index.set(row.key, {
					key: row.key,
					hop: hit.hop,
					originRisk: hit.originRisk,
					originKey: hit.originKey,
					originSource: hit.originSource,
					...(hit.originEntity ? { originEntity: hit.originEntity } : {}),
					originCategory: hit.originCategory,
					since: hit.height
				});
				await finish(row, 'hit', null, { ...detail, from: hit.fromAddress, originKey: hit.originKey, hop: hit.hop, risk: hit.risk });
				m.hits++;
				chainM(chain).hits++;
				log.info(`watch: ${row.key} (~$${Math.round(usd).toLocaleString('en-US')} into THORChain) funded ${hit.action === 'l1_funding' ? 'one hop' : 'two hops'} from ${hit.originEntity ?? hit.originKey} (${hit.originSource}): traced at hop ${hit.hop}`);
			} else {
				await finish(row, 'done', null, detail);
			}
		} catch (e) {
			if (e instanceof QuotaExceeded || e instanceof NoExplorer) {
				exhausted.add(chain);
				skip(chain, 'quota');
				continue; // stays pending for the next run
			}
			m.errors++;
			await sql.query(`UPDATE oz_watch_queue SET attempts = attempts + 1, reason = $2, status = CASE WHEN attempts >= 2 THEN 'error' ELSE status END, checked_at = now() WHERE key = $1`, [
				row.key,
				(e as Error).message.slice(0, 300)
			]);
		}
	}
	m.pending = (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_watch_queue WHERE status = 'pending'`)).rows[0]?.n ?? 0;
	const skippedTotal = Object.values(m.skipped).reduce((a, b) => a + b, 0);
	await bumpMetrics(sql, { lookbacks: m.lookbacks, hits: m.hits, skipped: skippedTotal, errors: m.errors }, m);
	return m;
}

/** The stored metrics (totals since the first run, the last 14 days, the last run). */
export async function watchMetrics(sql: Sql) {
	return getState<{ since: string; totals: Record<string, number>; days: Record<string, Record<string, number>>; last?: WatchRunMetrics & { at: string } }>(sql, 'watch:metrics');
}

/** Read the watch configuration from the environment (OZONE_WATCH_MIN_USD, OZONE_WATCH_HOPS, OZONE_WATCH_LOOKBACK_DAYS). */
export function watchConfigFromEnv(env: Record<string, string | undefined> = process.env): WatchConfig {
	const n = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
	return {
		...DEFAULT_WATCH_CONFIG,
		...(n(env.OZONE_WATCH_MIN_USD) !== undefined ? { minUsd: n(env.OZONE_WATCH_MIN_USD)! } : {}),
		...(n(env.OZONE_WATCH_HOPS) === 1 ? { hops: 1 as const } : {}),
		...(n(env.OZONE_WATCH_LOOKBACK_DAYS) !== undefined ? { lookbackDays: n(env.OZONE_WATCH_LOOKBACK_DAYS)! } : {})
	};
}
