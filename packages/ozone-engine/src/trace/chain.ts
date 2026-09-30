/**
 * THORChain transaction events as a source of value flows.
 *
 * Midgard shows a CosmWasm call only as `contract` actions that carry no
 * coins, and a swap that a contract starts as a swap from the contract's own
 * address. So value a flagged account sends through a Rujira contract — a FIN
 * swap with a recipient, a payout to a third party, a position funded for
 * another owner, a swap the contract starts toward an L1 address — never
 * reaches the Midgard-based tracer. The chain's own transaction events show it:
 * every bank transfer a message causes (`transfer`: sender, recipient, amount,
 * msg_index) and the contract's own events (`wasm-…`: owner, recipient, memo).
 * Measured against THORNode 3.20.3 (Liquify gateway, 2026-09-30) on Rujira
 * FIN, Liquidy and thorchain-swap transactions; see test/fixtures/chain-*.json.
 *
 * Attribution rules. A contract call can pay accounts that have nothing to do
 * with its signer (a keeper poke that distributes rewards), so a flow from the
 * signer is only read where the signer's own value is involved:
 *
 * - the signer **put value in** (its net outflow in that message is positive:
 *   funds attached, or pulled), or **acts on its own position** (a `wasm-…`
 *   event of the message names it as `owner` or `borrower`);
 * - every regular account (not the signer, a module account or a contract)
 *   whose net inflow in that message is positive received it from the signer
 *   (`swap {to}`, a payout to a third party, a plain transfer);
 * - a `wasm-…` event that names another account as `owner`, `recipient`,
 *   `beneficiary`, `receiver` or `to` in a message where the signer put value
 *   in is a position funded for that account;
 * - a `wasm-…` event with a swap `memo` whose destination is another account
 *   or an L1 address is a swap the contract starts for the signer toward it.
 *
 * Value: what the recipient received when that can be priced, never more than
 * the signer put in; when the recipient's coins have no price (Rujira's own
 * tokens), what the signer put in. A flow whose value is unknown on both sides
 * is not read — an unpriced token must not be a way to flag an account — and a
 * side payment under 5 % of the largest one (an affiliate or platform fee) is
 * not a flow. What is not visible in any event (the maker of a FIN limit order
 * a swap fills is credited inside the contract) is not traced.
 */
import { detectAddress, parseForChain, type ParsedAddress } from '../../../ozone-client/src/index.js';
import { DEFAULT_THORNODE_URL } from '../explorers/thornode.js';
import { httpJson, RateLimiter, type HttpOptions } from '../util/http.js';
import { CONTRACT_ACTION, chainOfAsset, formatAmount, isExcludedTarget, type Flow } from './flows.js';
import { l1Asset, type PriceOracle } from './prices.js';

export interface ChainEvent {
	type: string;
	attributes: Array<{ key: string; value: string }>;
}

/** What tracing needs of a transaction (the LCD's `tx_responses` item). */
export interface ChainTx {
	/** Transaction hash (upper-case hex). */
	hash: string;
	height: number;
	/** Block time (ISO). */
	date: string;
	/** 0 = succeeded; a failed transaction moved nothing. */
	code: number;
	events: ChainEvent[];
}

export interface ChainCoin {
	denom: string;
	amount: bigint;
}

export const WASM_EXECUTE = '/cosmwasm.wasm.v1.MsgExecuteContract';

/** `wasm-…` attributes that say the signer acts on its own position. */
const OWNER_KEYS = ['owner', 'borrower'];
/** `wasm-…` attributes that name another account as the owner or receiver of what the signer funded. */
const BENEFICIARY_KEYS = ['owner', 'recipient', 'beneficiary', 'receiver', 'to'];
/** A side payment under this share of the largest one is a fee, not a flow. */
const FEE_SHARE = 0.05;

function attr(ev: ChainEvent, key: string): string | undefined {
	for (const a of ev.attributes) if (a.key === key) return a.value;
	return undefined;
}

/** `"1420btc-btc,781eth-wbtc-0x…"` → coins. */
export function parseCoins(text: string | undefined): ChainCoin[] {
	if (!text) return [];
	const out: ChainCoin[] = [];
	for (const part of text.split(',')) {
		const m = /^(\d+)(\S+)$/.exec(part.trim());
		if (m) out.push({ amount: BigInt(m[1]), denom: m[2] });
	}
	return out;
}

/**
 * A bank denom as a THORChain asset (what the price oracle knows): `rune`,
 * secured assets (`btc-btc`, `eth-usdt-0x…`), Rujira's `x/ruji`. Anything else
 * (`factory/…`, `x/bow-…`, `ibc/…`) is returned as it is: no price.
 */
export function denomAsset(denom: string): string {
	const d = denom.toLowerCase();
	if (d === 'rune') return 'THOR.RUNE';
	if (d === 'tcy') return 'THOR.TCY';
	if (d === 'x/ruji') return 'THOR.RUJI';
	if (/^[a-z0-9]+-[a-z0-9]+(-0x[0-9a-f]+)?$/.test(d)) return l1Asset(d.toUpperCase());
	return d;
}

/** USD value of coins when every one is priced; undefined otherwise. */
function usdOf(coins: ChainCoin[], prices?: PriceOracle): number | undefined {
	if (!coins.length || !prices) return undefined;
	let sum = 0;
	for (const c of coins) {
		const p = prices.priceUsd(denomAsset(c.denom));
		if (!p) return undefined;
		sum += (Number(c.amount) / 1e8) * p;
	}
	return sum;
}

const SWAP_MEMO_COMMANDS = new Set(['=', '=<', 's', 'swap']);

/**
 * The destination of a THORChain swap memo (`=:ASSET:DEST[/…]:LIMIT…`) as an
 * address, or undefined for any other memo or an unparseable destination.
 */
export function memoDestination(memo: string | undefined): ParsedAddress | undefined {
	if (!memo) return undefined;
	const parts = memo.trim().split(':');
	if (!SWAP_MEMO_COMMANDS.has(parts[0]?.toLowerCase() ?? '')) return undefined;
	const dest = parts[2]?.split('/')[0]?.trim();
	if (!dest) return undefined;
	const assetChain = parts[1] ? chainOfAsset(parts[1].toUpperCase()) : undefined;
	return parseForChain(dest, 'THOR') ?? (assetChain && assetChain !== 'THOR' ? parseForChain(dest, assetChain) : null) ?? detectAddress(dest)[0] ?? undefined;
}

interface Recipient {
	p: ParsedAddress;
	coins: ChainCoin[];
}

/** The value flows a transaction's CosmWasm messages moved from their signers to other accounts (see the module notes). */
export function extractChainFlows(tx: ChainTx, prices?: PriceOracle): Flow[] {
	if (tx.code !== 0) return [];
	const byMsg = new Map<number, ChainEvent[]>();
	for (const ev of tx.events) {
		const raw = attr(ev, 'msg_index');
		if (raw === undefined) continue; // transaction-level events (the fee)
		const i = Number(raw);
		if (!Number.isInteger(i)) continue;
		const list = byMsg.get(i);
		if (list) list.push(ev);
		else byMsg.set(i, [ev]);
	}
	const flows = new Map<string, Flow>();
	for (const evs of byMsg.values()) {
		const exec = evs.find((e) => e.type === 'message' && attr(e, 'action') === WASM_EXECUTE);
		const signer = exec ? attr(exec, 'sender') : undefined;
		const from = signer ? parseForChain(signer, 'THOR') : null;
		if (!signer || !from || from.kind !== 'account') continue;

		// net balance change of every account in this message
		const net = new Map<string, Map<string, bigint>>();
		const bump = (who: string, denom: string, by: bigint) => {
			const m = net.get(who) ?? new Map<string, bigint>();
			m.set(denom, (m.get(denom) ?? 0n) + by);
			net.set(who, m);
		};
		for (const ev of evs) {
			if (ev.type !== 'transfer') continue;
			const s = attr(ev, 'sender');
			const r = attr(ev, 'recipient');
			if (!s || !r) continue;
			for (const c of parseCoins(attr(ev, 'amount'))) {
				bump(s, c.denom, -c.amount);
				bump(r, c.denom, c.amount);
			}
		}
		const signed = (who: string, sign: 1 | -1): ChainCoin[] =>
			[...(net.get(who) ?? [])].filter(([, v]) => (sign === 1 ? v > 0n : v < 0n)).map(([denom, v]) => ({ denom, amount: sign === 1 ? v : -v }));

		const put = signed(signer, -1);
		const wasm = evs.filter((e) => e.type.startsWith('wasm'));
		const ownsPosition = wasm.some((e) => OWNER_KEYS.some((k) => attr(e, k) === signer));
		if (!put.length && !ownsPosition) continue; // a poke: nothing of the signer's moved

		const recipients = new Map<string, Recipient>();
		for (const who of net.keys()) {
			if (who === signer) continue;
			const p = parseForChain(who, 'THOR');
			if (!p || isExcludedTarget(p)) continue;
			const coins = signed(who, 1);
			if (coins.length) recipients.set(p.key, { p, coins });
		}
		if (put.length) {
			for (const e of wasm) {
				for (const k of BENEFICIARY_KEYS) {
					const v = attr(e, k);
					if (!v || v === signer) continue;
					const p = parseForChain(v, 'THOR');
					if (p && !isExcludedTarget(p) && !recipients.has(p.key)) recipients.set(p.key, { p, coins: [] });
				}
				// the output of a swap toward an address is not known in the event (it leaves later): valued by the input
				const dest = memoDestination(attr(e, 'memo'));
				if (dest && dest.key !== from.key && !isExcludedTarget(dest) && !recipients.has(dest.key)) recipients.set(dest.key, { p: dest, coins: [] });
			}
		}

		const putUsd = usdOf(put, prices);
		const valued = [...recipients.values()].map((r) => ({ r, usd: usdOf(r.coins, prices) }));
		const largest = Math.max(0, ...valued.map((v) => v.usd ?? 0));
		for (const { r, usd } of valued) {
			if (valued.length > 1 && usd !== undefined && largest > 0 && usd < largest * FEE_SHARE) continue; // affiliate / platform fee
			const value = usd !== undefined ? (putUsd !== undefined ? Math.min(usd, putUsd) : usd) : putUsd;
			if (value === undefined || !(value > 0)) continue; // unknown on both sides: never flag on it
			const shown = r.coins.length ? r.coins : put;
			const flow: Flow = {
				txid: tx.hash.toUpperCase(),
				height: tx.height,
				date: tx.date,
				action: CONTRACT_ACTION,
				relation: 'value',
				fromKey: from.key,
				fromAddress: from.address,
				fromChain: from.chain,
				toKey: r.p.key,
				toAddress: r.p.address,
				toChain: r.p.chain,
				amount: shown.map((c) => formatAmount(c.amount.toString(), denomAsset(c.denom))).join(' + ') || undefined,
				usd: value
			};
			const prev = flows.get(r.p.key);
			if (!prev || (prev.usd ?? 0) < value) flows.set(r.p.key, flow);
		}
	}
	return [...flows.values()];
}

// ---------------------------------------------------------------------------
// THORNode client (Cosmos LCD)
// ---------------------------------------------------------------------------

/** Transactions per page of the LCD search. */
export const TX_PAGE_SIZE = 50;

/** Where a bounded read stopped: `complete` when the last matching transaction was read, else `resumeHeight` is where to read again (inclusive). */
export interface ChainRead {
	complete: boolean;
	resumeHeight?: number;
}

export interface ChainOptions {
	/** THORNode API base (default THORNODE_URL or the Liquify gateway). */
	baseUrl?: string;
	/** Minimum interval between requests (default 350 ms). */
	minIntervalMs?: number;
	concurrency?: number;
	http?: HttpOptions;
}

export interface WasmTxQuery {
	/** Only transactions with a message signed by this thor address. */
	signer?: string;
	fromHeight: number;
	toHeight?: number;
	/** Pages of TX_PAGE_SIZE (default 40). */
	maxPages?: number;
	/** Stop reading more pages once this time (ms since the epoch) has passed: a search page can take many seconds. */
	deadline?: number;
	progress?: ChainRead;
}

const THOR_ADDRESS = /^thor1[02-9ac-hj-np-z]{38,58}$/;

interface LcdTx {
	txhash?: string;
	height?: string;
	timestamp?: string;
	code?: number;
	events?: ChainEvent[];
}

/** Transactions of the chain as tracing needs them: contract executions, oldest first. */
export class Chain {
	readonly baseUrl: string;
	private readonly limiter: RateLimiter;
	requests = 0;

	constructor(private readonly opts: ChainOptions = {}) {
		this.baseUrl = (opts.baseUrl ?? process.env.THORNODE_URL ?? DEFAULT_THORNODE_URL).replace(/\/+$/, '');
		this.limiter = new RateLimiter(opts.minIntervalMs ?? 350, opts.concurrency ?? 1);
	}

	private get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(params ?? {})) q.set(k, String(v));
		const url = `${this.baseUrl}${path}${q.size ? `?${q.toString()}` : ''}`;
		this.requests++;
		return this.limiter.run(() => httpJson<T>(url, { timeoutMs: 60_000, retries: 2, ...this.opts.http }));
	}

	/** The newest block height. */
	async latestHeight(): Promise<number> {
		const rows = await this.get<Array<{ thorchain?: number }>>('/thorchain/lastblock');
		const h = Number(rows?.[0]?.thorchain);
		if (!Number.isInteger(h) || h <= 0) throw new Error('THORNode returned no block height');
		return h;
	}

	/**
	 * CosmWasm executions at or after `fromHeight` (and up to `toHeight`),
	 * oldest first, at most `maxPages` pages. `progress` (when given) is filled
	 * in when the generator finishes.
	 */
	async *wasmTxs(q: WasmTxQuery): AsyncGenerator<ChainTx> {
		if (q.signer !== undefined && !THOR_ADDRESS.test(q.signer)) throw new Error(`not a thor address: ${q.signer}`);
		const conds = [`message.action='${WASM_EXECUTE}'`, `tx.height>=${Math.max(1, Math.floor(q.fromHeight))}`];
		if (q.toHeight !== undefined) conds.push(`tx.height<=${Math.floor(q.toHeight)}`);
		if (q.signer) conds.push(`message.sender='${q.signer}'`);
		const maxPages = Math.max(1, q.maxPages ?? 40);
		let lastHeight = 0;
		for (let page = 1; ; page++) {
			const body = await this.get<{ tx_responses?: LcdTx[]; total?: string | number }>('/cosmos/tx/v1beta1/txs', {
				query: conds.join(' AND '),
				limit: TX_PAGE_SIZE,
				page,
				order_by: 'ORDER_BY_ASC'
			});
			const rows = body.tx_responses ?? [];
			for (const r of rows) {
				const height = Number(r.height);
				if (!r.txhash || !Number.isFinite(height)) continue;
				lastHeight = Math.max(lastHeight, height);
				yield { hash: r.txhash.toUpperCase(), height, date: r.timestamp ?? new Date(0).toISOString(), code: Number(r.code ?? 0), events: r.events ?? [] };
			}
			const total = Number(body.total);
			if (rows.length < TX_PAGE_SIZE || (Number.isFinite(total) && page * TX_PAGE_SIZE >= total)) {
				if (q.progress) {
					q.progress.complete = true;
					delete q.progress.resumeHeight;
				}
				return;
			}
			if (page >= maxPages || (q.deadline !== undefined && Date.now() > q.deadline)) {
				// The last height of this page may continue on the next one: read it again.
				if (q.progress) {
					q.progress.complete = false;
					q.progress.resumeHeight = lastHeight;
				}
				return;
			}
		}
	}
}

/** What tracing needs from the chain (lets tests and alternative sources plug in). */
export type ChainLike = Pick<Chain, 'latestHeight' | 'wasmTxs'>;
