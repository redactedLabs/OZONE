/**
 * Event history of a contract from keyless public EVM endpoints, with
 * failover, block-range adaptation and a stored, resumable history.
 *
 * Why (2026-10-06, about 06:12 UTC): the keyless Blockscout instances
 * (arbitrum., base., polygon.blockscout.com) started answering every API
 * request with a Cloudflare challenge page (HTTP 403, "Just a moment..."), and
 * the only RPC configured for Base (Tenderly's public gateway) serves at most
 * 1,000 blocks per eth_getLogs. Every source that needed Arbitrum, Polygon or
 * Base failed from its next sync on: chainalysis_oracle_other_chains, circle
 * (its Base leg), circle_other_chains and tether_usdt0. A challenge page is
 * not something to get around; the sources now read public JSON-RPC
 * endpoints first and use explorers only as a fallback.
 *
 * For each chain, the endpoints are tried in order:
 *
 * 1. **full replay**: the whole history in a few eth_getLogs calls, on an
 *    endpoint whose block-range limit allows it (Tenderly serves whole
 *    histories on Ethereum, Arbitrum, Optimism, Polygon and Avalanche; the
 *    official Optimism and Arbitrum RPCs 10M-block ranges), then the
 *    chain's Etherscan-compatible explorer. Every sync replays the history,
 *    so the result never depends on an earlier run;
 * 2. **incremental**: where no endpoint can replay the history (Base: every
 *    keyless endpoint limits eth_getLogs to 10,000 blocks or fewer), the
 *    stored history (`oz_state` `evmlogs:v1:<chain>:<contract>`) is extended
 *    from where it ends, in ranges the endpoints accept;
 * 3. **bootstrap**: without a stored history, it is read from the start
 *    (the contract's deployment block) in small ranges, within a time budget
 *    per sync and resumed at the next one; until it is complete the sync
 *    fails with its progress in the error (visible in /api/health), and the
 *    source keeps its previous entries.
 *
 * Range adaptation: an endpoint's refusal names its limit in many dialects
 * ("maximum 1000 blocks", "limited to a 500 range", "ranges over 10000
 * blocks", "only 10000000 are allowed", "exceed maximum block range: 50000");
 * the limit is learned per host and used from then on. A refusal without a
 * number (a timeout, too many results) halves the range. An endpoint that
 * wants a key for history ("personal token", "API key", "not available for
 * unregistered accounts") or does not support eth_getLogs is skipped.
 *
 * Integrity: endpoints are untrusted. A log for another contract or event
 * than requested is dropped, and a full replay that lacks a log the stored
 * history has (an endpoint without the old blocks answering "no logs")
 * is refused and the next endpoint is asked. Logs within `finality` blocks
 * of the head are read on every sync and never stored (reorgs).
 */
import type { Logger, Sql } from '../types.js';
import { httpJson, RateLimiter, USER_AGENT, type HttpOptions } from '../util/http.js';

export interface RawLog {
	blockNumber: number;
	logIndex: number;
	timeStamp: number;
	transactionHash: string;
	address: string;
	topics: string[];
	data: string;
}

export interface LogsResult {
	logs: RawLog[];
	/** Logs the endpoint returned whose emitting address or topics[0] did not match what was requested. */
	dropped: number;
}

export interface LogProvider {
	kind: 'rpc' | 'explorer';
	/** JSON-RPC URL, or an Etherscan-compatible `…/api` base URL. */
	url: string;
	/** Blocks one eth_getLogs may cover (inclusive count), when known; learned from refusals otherwise. */
	maxRange?: number;
	/** Minimum interval between requests to this host. */
	minIntervalMs?: number;
	/** Explorer: extra query parameters (an API key, a chain id). */
	params?: Record<string, string>;
}

export interface ChainLogConfig {
	chain: string;
	providers: LogProvider[];
	/** Blocks at the head that are read on every sync but never stored (reorg margin). */
	finality: number;
	txUrl: (hash: string) => string;
}

export interface ContractLogsRequest {
	config: ChainLogConfig;
	contract: string;
	/** Event signatures (topic0), read together. */
	topics: string[];
	/** First block worth reading (the contract's deployment), default 0. */
	fromBlock?: number;
	/**
	 * Where no endpoint can replay the history and none is stored yet: a known
	 * state to start from instead of reading every block in small ranges (the
	 * logs a source last published, up to block `to`). Its logs carry block 0
	 * and are replaced by the first full replay that becomes possible.
	 */
	seed?: (head: number) => Promise<{ logs: RawLog[]; to: number } | undefined>;
}

export interface ContractLogsOptions extends HttpOptions {
	logger?: Logger;
	/** Where the history is stored (incremental reads, bootstrap); without it only full replays are possible. */
	sql?: Sql;
	/** Wall-clock budget of a history read in small ranges (bootstrap or a long incremental), default 50 min. */
	budgetMs?: number;
	/** Most eth_getLogs calls a full replay may take on one endpoint (default 400). */
	fullReplayMaxCalls?: number;
	now?: () => number;
}

export interface ContractLogsResult extends LogsResult {
	mode: 'full' | 'incremental' | 'bootstrap';
	/** Host that served the history (or the new range). */
	provider: string;
}

/** Thrown while a history is still being read in small ranges (the source keeps its entries). */
export class HistoryInProgress extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'HistoryInProgress';
	}
}

class EndpointUnusable extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const host = (url: string) => new URL(url).host;
const toHex = (n: number) => '0x' + n.toString(16);
const hexOrDec = (v: unknown): number => {
	if (typeof v === 'number') return v;
	const s = String(v ?? '0');
	return s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
};

const limiters = new Map<string, RateLimiter>();
/** One rate limiter per host, shared by every source and chain in the process. */
export function limiterFor(url: string, minIntervalMs = 1000): RateLimiter {
	const h = host(url);
	let l = limiters.get(h);
	if (!l) {
		l = new RateLimiter(minIntervalMs, 1);
		limiters.set(h, l);
	}
	return l;
}

/** Block-range limits learned from refusals, per host (inclusive block count). */
const learnedRange = new Map<string, number>();

/** Tests. */
export function resetLearnedRanges(): void {
	learnedRange.clear();
	limiters.clear();
}

const RANGE_PATTERNS: RegExp[] = [
	/maximum (?:allowed is )?(\d+) blocks?/i, // Tenderly "maximum 1000 blocks", Nodies "maximum allowed is 50 blocks"
	/limited to (?:a |0 ?- ?)?(\d+)(?: blocks?)? range/i, // base.org "limited to a 500 range", 1RPC "limited to 0 - 50 blocks range"
	/ranges? over (\d+) blocks?/i, // dRPC "ranges over 10000 blocks are not supported"
	/only (\d+) are allowed/i, // Arbitrum "query spans … but only 10000000 are allowed"
	/maximum block range:? ?(\d+)/i, // PublicNode "exceed maximum block range: 10000"
	/up to a (\d+) block range/i, // Blast "up to a 10 block range"
	/maximum allowed number of requested blocks is (\d+)/i, // thirdweb
	/over limit of (\d+)/i, // Tatum "Requested range is over limit of 100"
	/block range (?:limit|is limited to|too large)[^\d]{0,40}(\d+)/i
];

/** The block-range limit an endpoint's refusal names (inclusive count), if any. */
export function parseRangeLimit(message: string): number | undefined {
	for (const re of RANGE_PATTERNS) {
		const m = re.exec(message);
		if (m) {
			const n = Number(m[1]);
			if (Number.isFinite(n) && n > 0) return n;
		}
	}
	return undefined;
}

/** Refusals that mean the endpoint cannot serve this read at all. */
const UNUSABLE = /personal token|api[- ]?key|unauthori[sz]ed|not available for unregistered|discontinued|upgrade your|method .*not (?:supported|found|available)|not supported|does not exist\/is not available|tenant disabled|^HTTP 40[1345]\b|not JSON/i;

interface RpcLog {
	blockNumber: string;
	logIndex: string;
	transactionHash: string;
	address?: string;
	topics: string[];
	data: string;
	blockTimestamp?: string;
}

interface RpcAnswer<T> {
	result?: T;
	error?: { message?: string; data?: unknown; code?: number };
}

/**
 * One JSON-RPC POST. Unlike httpJson, the body of a refusal is kept: endpoints
 * name their block-range limit in 400/413 answers (dRPC, base.org) and their
 * key requirement in 401/403 ones. 429 and 5xx are retried once.
 */
async function rpc<T>(p: LogProvider, body: unknown, opts: HttpOptions): Promise<RpcAnswer<T>> {
	const fetchImpl = opts.fetch ?? fetch;
	let lastError = '';
	for (let attempt = 0; attempt <= Math.min(1, opts.retries ?? 1); attempt++) {
		try {
			const res = await limiterFor(p.url, p.minIntervalMs ?? 500).run(async () => {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
				try {
					const r = await fetchImpl(p.url, {
						method: 'POST',
						body: JSON.stringify(body),
						signal: controller.signal,
						headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT, ...(opts.headers ?? {}) }
					});
					return { status: r.status, text: await r.text(), retryAfter: Number(r.headers?.get?.('retry-after')) };
				} finally {
					clearTimeout(timer);
				}
			});
			let parsed: unknown;
			try {
				parsed = JSON.parse(res.text);
			} catch {
				parsed = undefined;
			}
			if (res.status === 429 || res.status >= 500) {
				lastError = `HTTP ${res.status}${parsed && typeof parsed === 'object' ? ` ${errorText((parsed as RpcAnswer<T>).error ?? (parsed as RpcAnswer<T>['error']))}` : ''}`;
				if (attempt === 0) await sleep(res.status === 429 && res.retryAfter > 0 ? Math.min(30_000, res.retryAfter * 1000) : 1500);
				continue;
			}
			if (Array.isArray(parsed)) return parsed as unknown as RpcAnswer<T>; // a batch answer
			if (parsed && typeof parsed === 'object') {
				const o = parsed as RpcAnswer<T> & { message?: string };
				if (res.status >= 400 && !o.error) return { error: { message: `HTTP ${res.status} ${o.message ?? ''}`.trim() } };
				return o;
			}
			return { error: { message: `HTTP ${res.status}: not JSON (${res.text.slice(0, 60).replace(/\s+/g, ' ')})` } };
		} catch (e) {
			lastError = (e as Error).message;
			if (attempt === 0) await sleep(1000);
		}
	}
	return { error: { message: lastError || 'no answer' } };
}

const errorText = (e: RpcAnswer<unknown>['error']): string => `${e?.message ?? ''} ${typeof e?.data === 'string' ? e.data : e?.data ? JSON.stringify(e.data) : ''}`.trim();

/** The chain head from the first endpoint that answers. */
async function headOf(providers: LogProvider[], opts: HttpOptions, logger?: Logger): Promise<{ head: number; host: string } | undefined> {
	for (const p of providers) {
		if (p.kind !== 'rpc') continue;
		const r = await rpc<string>(p, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, opts);
		const v = typeof r.result === 'string' && /^0x[0-9a-f]+$/i.test(r.result) ? parseInt(r.result, 16) : 0;
		if (v > 0) return { head: v, host: host(p.url) };
		logger?.warn(`rpc ${host(p.url)}: no block number (${errorText(r.error) || 'unexpected answer'})`);
	}
	return undefined;
}

interface ScanResult {
	logs: RpcLog[];
	/** Highest block of an unbroken scanned range starting at `from` (from - 1: nothing). */
	reached: number;
	calls: number;
}

/**
 * eth_getLogs over [from, to] on one endpoint, in ranges it accepts (learned
 * from its refusals), until `to`, `maxCalls` or `deadline`. Throws
 * EndpointUnusable when the endpoint cannot serve the read at all.
 */
async function scanRpc(
	p: LogProvider,
	contract: string,
	topics: string[],
	from: number,
	to: number,
	opts: HttpOptions & { maxCalls?: number; deadline?: number; now: () => number; replay?: boolean }
): Promise<ScanResult> {
	const h = host(p.url);
	const known = learnedRange.get(h) ?? p.maxRange;
	let range = Math.max(1, known ?? to - from + 1);
	const logs: RpcLog[] = [];
	let a = from;
	let calls = 0;
	let failures = 0;
	let streak = 0;
	while (a <= to) {
		if (opts.deadline !== undefined && opts.now() > opts.deadline) break;
		if (opts.maxCalls !== undefined && calls >= opts.maxCalls) break;
		const b = Math.min(to, a + range - 1);
		calls++;
		const res = await rpc<RpcLog[]>(
			p,
			{ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: contract, topics: [topics.length === 1 ? topics[0] : topics], fromBlock: toHex(a), toBlock: toHex(b) }] },
			opts
		);
		if (Array.isArray(res.result)) {
			logs.push(...res.result);
			a = b + 1;
			failures = 0;
			// a range halved after a transient refusal grows back (never past a learned limit)
			if (++streak >= 4 && range < (learnedRange.get(h) ?? p.maxRange ?? Infinity)) {
				range = Math.min(range * 2, learnedRange.get(h) ?? p.maxRange ?? range * 2);
				streak = 0;
			}
			continue;
		}
		streak = 0;
		const msg = errorText(res.error) || 'no result';
		const limit = parseRangeLimit(msg);
		const span = b - a + 1;
		if (limit && limit < span) {
			learnedRange.set(h, limit);
			range = limit;
			// a replay that would now take more calls than allowed is not one: leave it to the stored history
			if (opts.replay && opts.maxCalls !== undefined && Math.ceil((to - a + 1) / limit) > opts.maxCalls - calls) {
				throw new EndpointUnusable(`${h}: serves at most ${limit} blocks per call`);
			}
			continue;
		}
		if (UNUSABLE.test(msg)) throw new EndpointUnusable(`${h}: ${msg.slice(0, 160)}`);
		if (span > 1) {
			range = Math.max(1, Math.floor(span / 2));
			continue;
		}
		if (++failures >= 3) throw new Error(`${h}: eth_getLogs failed at block ${a}: ${msg.slice(0, 160)}`);
		await sleep(1000 * failures);
	}
	return { logs, reached: a - 1, calls };
}

/** Block timestamps of logs that came without one (eth_getBlockByNumber, batched when the endpoint allows it). */
async function fillTimestamps(p: LogProvider, logs: RpcLog[], opts: HttpOptions): Promise<Map<string, number>> {
	const ts = new Map<string, number>();
	const missing = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))];
	let batch = true;
	for (let i = 0; i < missing.length; ) {
		if (batch) {
			const slice = missing.slice(i, i + 25);
			const res = await rpc<unknown>(
				p,
				slice.map((bn, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getBlockByNumber', params: [bn, false] })),
				opts
			);
			const arr = Array.isArray(res) ? (res as Array<{ id: number; result?: { timestamp?: string } }>) : undefined;
			if (!arr) {
				batch = false; // this endpoint does not take batches: one call per block
				continue;
			}
			for (const r of arr) {
				const bn = slice[r.id];
				if (bn && r.result?.timestamp) ts.set(bn, parseInt(r.result.timestamp, 16));
			}
			i += slice.length;
		} else {
			const bn = missing[i];
			const r = await rpc<{ timestamp?: string }>(p, { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [bn, false] }, opts);
			if (r.result?.timestamp) ts.set(bn, parseInt(r.result.timestamp, 16));
			i++;
		}
	}
	return ts;
}

function checkLogs(raw: RawLog[], contract: string, topics: string[]): LogsResult {
	const wantAddress = contract.toLowerCase();
	const wantTopics = new Set(topics.map((t) => t.toLowerCase()));
	const logs: RawLog[] = [];
	const seen = new Set<string>();
	let dropped = 0;
	for (const l of raw) {
		// The endpoint is untrusted: never accept a log for a different contract
		// or event than what was requested, however it slipped in.
		if (l.address.toLowerCase() !== wantAddress || !wantTopics.has((l.topics[0] ?? '').toLowerCase())) {
			dropped++;
			continue;
		}
		const id = `${l.transactionHash.toLowerCase()}:${l.logIndex}`;
		if (seen.has(id)) continue;
		seen.add(id);
		logs.push(l);
	}
	logs.sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
	return { logs, dropped };
}

async function toRawLogs(p: LogProvider, logs: RpcLog[], opts: HttpOptions): Promise<RawLog[]> {
	const ts = await fillTimestamps(p, logs, opts);
	const out = logs.map((l) => ({
		blockNumber: parseInt(l.blockNumber, 16),
		logIndex: parseInt(l.logIndex, 16),
		timeStamp: l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : (ts.get(l.blockNumber) ?? 0),
		transactionHash: l.transactionHash,
		address: l.address ?? '',
		topics: l.topics ?? [],
		data: l.data ?? '0x'
	}));
	if (out.some((l) => !l.timeStamp)) throw new Error(`${host(p.url)}: missing block timestamps`);
	return out;
}

/** Full history of one event of one contract from an Etherscan-compatible explorer API, oldest first. */
export async function explorerLogs(
	p: LogProvider,
	chain: string,
	contract: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger; maxPages?: number } = {}
): Promise<LogsResult> {
	const out: RawLog[] = [];
	const seen = new Set<string>();
	let fromBlock = opts.fromBlock ?? 0;
	const maxPages = opts.maxPages ?? 500;
	const extra = Object.entries(p.params ?? {})
		.map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('');
	for (let page = 0; page < maxPages; page++) {
		const url = `${p.url}?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=latest&address=${contract}&topic0=${topic0}${extra}`;
		const body = await limiterFor(url, p.minIntervalMs ?? 1000).run(() => httpJson<{ status?: string; message?: string; result?: unknown }>(url, { retries: 5, ...opts }));
		const result = Array.isArray(body.result) ? (body.result as Array<Record<string, unknown>>) : [];
		if (!Array.isArray(body.result) && body.status !== '0') {
			throw new Error(`${chain} logs: unexpected answer ${String(body.message ?? '').slice(0, 80)}`);
		}
		if (!Array.isArray(body.result) && body.status === '0' && !/no (?:records|logs) found/i.test(String(body.message ?? ''))) {
			// "NOTOK", "Max rate limit reached", "chain not supported": an error, not an empty history
			throw new Error(`${chain} logs: ${String(body.message ?? 'error').slice(0, 80)}`);
		}
		let added = 0;
		let maxBlock = fromBlock;
		for (const r of result) {
			const log: RawLog = {
				blockNumber: hexOrDec(r.blockNumber),
				logIndex: hexOrDec(r.logIndex),
				timeStamp: hexOrDec(r.timeStamp),
				transactionHash: String(r.transactionHash ?? ''),
				address: String(r.address ?? ''),
				topics: ((r.topics as Array<string | null>) ?? []).filter((t): t is string => !!t),
				data: String(r.data ?? '0x')
			};
			const id = `${log.transactionHash}:${log.logIndex}:${log.address.toLowerCase()}:${(log.topics[0] ?? '').toLowerCase()}`;
			maxBlock = Math.max(maxBlock, log.blockNumber);
			if (seen.has(id)) continue;
			seen.add(id);
			added++;
			out.push(log);
		}
		// Explorers cap a page (Blockscout 1000, Routescan 100): continue from
		// the last block seen (inclusive) until a page adds nothing new.
		if (added === 0 || result.length < 100) break;
		if (maxBlock === fromBlock && added < result.length) {
			opts.logger?.warn(`${chain} logs: more events in block ${fromBlock} than one page can hold`);
			fromBlock = maxBlock + 1;
		} else {
			fromBlock = maxBlock;
		}
	}
	return checkLogs(out, contract, [topic0]);
}

// ---------------------------------------------------------------------------
// Stored history
// ---------------------------------------------------------------------------

/** [block, logIndex, time, tx, topic index, topics[1] | null, data | null] */
type StoredLog = [number, number, number, string, number, string | null, string | null];

interface StoredHistory {
	v: 1;
	topics: string[];
	/** First block of the history (the request's fromBlock). */
	from: number;
	/** Last block read without a gap (never within the finality margin). */
	to: number;
	/** True once the history runs from `from` to `to` without a gap. */
	complete: boolean;
	/** When a full replay last confirmed it. */
	fullAt?: string;
	logs: StoredLog[];
}

const historyId = (chain: string, contract: string) => `evmlogs:v1:${chain}:${contract.toLowerCase()}`;

async function loadHistory(sql: Sql, id: string, topics: string[]): Promise<StoredHistory | undefined> {
	const r = await sql.query<{ value: StoredHistory | string }>(`SELECT value FROM oz_state WHERE id = $1`, [id]);
	const raw = r.rows[0]?.value;
	const v = typeof raw === 'string' ? (JSON.parse(raw) as StoredHistory) : raw;
	if (!v || v.v !== 1) return undefined;
	const want = topics.map((t) => t.toLowerCase()).join(',');
	return v.topics.map((t) => t.toLowerCase()).join(',') === want ? v : undefined;
}

async function saveHistory(sql: Sql, id: string, h: StoredHistory): Promise<void> {
	await sql.query(
		`INSERT INTO oz_state (id, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		[id, JSON.stringify(h)]
	);
}

function packLogs(logs: RawLog[], topics: string[]): StoredLog[] {
	const idx = new Map(topics.map((t, i) => [t.toLowerCase(), i]));
	return logs.map((l) => [l.blockNumber, l.logIndex, l.timeStamp, l.transactionHash, idx.get((l.topics[0] ?? '').toLowerCase()) ?? 0, l.topics[1] ?? null, l.data && l.data !== '0x' ? l.data : null]);
}

function unpackLogs(stored: StoredLog[], topics: string[], contract: string): RawLog[] {
	return stored.map(([blockNumber, logIndex, timeStamp, transactionHash, ti, t1, data]) => ({
		blockNumber,
		logIndex,
		timeStamp,
		transactionHash,
		address: contract,
		topics: [topics[ti] ?? topics[0], ...(t1 ? [t1] : [])],
		data: data ?? '0x'
	}));
}

const logId = (l: RawLog) => `${l.transactionHash.toLowerCase()}:${l.logIndex}`;

function mergeLogs(a: RawLog[], b: RawLog[]): RawLog[] {
	const byId = new Map<string, RawLog>();
	for (const l of [...a, ...b]) byId.set(logId(l), l);
	return [...byId.values()].sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * Every log of `topics` emitted by `contract` (see the module comment for the
 * order of endpoints, the stored history and the integrity rules).
 */
export async function readContractLogs(req: ContractLogsRequest, opts: ContractLogsOptions = {}): Promise<ContractLogsResult> {
	const { config, contract, topics } = req;
	const now = opts.now ?? Date.now;
	const log = opts.logger;
	const start = Math.max(0, req.fromBlock ?? 0);
	const id = historyId(config.chain, contract);
	const stored = opts.sql ? await loadHistory(opts.sql, id, topics).catch(() => undefined) : undefined;
	const storedLogs = stored ? unpackLogs(stored.logs, topics, contract) : [];
	const rpcs = config.providers.filter((p) => p.kind === 'rpc');
	const explorers = config.providers.filter((p) => p.kind === 'explorer');
	const errors: string[] = [];
	const head = await headOf(rpcs, opts, log);
	const safe = head ? head.head - config.finality : undefined;
	const label = `${config.chain} ${contract.slice(0, 10)}`;

	/** A full replay must contain every stored log of the range it covers (append-only events). */
	const complete = (logs: RawLog[], upTo: number): boolean => {
		if (!stored?.complete) return true;
		const have = new Set(logs.map(logId));
		// seeded logs (block 0) have no real block or log index: a replay replaces them
		const missing = storedLogs.filter((l) => l.blockNumber > 0 && l.blockNumber <= Math.min(upTo, stored.to) && l.blockNumber >= start && !have.has(logId(l)));
		if (missing.length) log?.warn(`${label}: an endpoint returned a history without ${missing.length} known log(s) (e.g. ${missing[0].transactionHash}): refused`);
		return missing.length === 0;
	};
	const store = async (logs: RawLog[], to: number, full: boolean) => {
		if (!opts.sql || to < start) return;
		// a full replay refreshes the stored history at most once a day (it only matters once replays stop working)
		if (full && stored?.complete && stored.fullAt && now() - Date.parse(stored.fullAt) < 24 * 3600_000) return;
		await saveHistory(opts.sql, id, {
			v: 1,
			topics,
			from: start,
			to,
			complete: true,
			fullAt: full ? new Date(now()).toISOString() : stored?.fullAt,
			logs: packLogs(
				logs.filter((l) => l.blockNumber <= to),
				topics
			)
		});
	};

	// 1. full replay
	if (head) {
		for (const p of rpcs) {
			const range = learnedRange.get(host(p.url)) ?? p.maxRange;
			const maxCalls = opts.fullReplayMaxCalls ?? 400;
			if (range && Math.ceil((head.head - start + 1) / range) > maxCalls) continue; // only small ranges: not for a replay
			try {
				const r = await scanRpc(p, contract, topics, start, head.head, { ...opts, maxCalls, now, replay: true });
				if (r.reached < head.head) throw new Error(`stopped at block ${r.reached} of ${head.head} after ${r.calls} calls`);
				const checked = checkLogs(await toRawLogs(p, r.logs, opts), contract, topics);
				if (!complete(checked.logs, head.head)) continue;
				log?.info(`${label}: ${checked.logs.length} logs from ${host(p.url)} in ${r.calls} call(s)`);
				await store(checked.logs, safe ?? head.head, true).catch((e) => log?.warn(`${label}: history not stored: ${(e as Error).message}`));
				return { ...checked, mode: 'full', provider: host(p.url) };
			} catch (e) {
				errors.push(`${host(p.url)}: ${(e as Error).message}`);
				log?.warn(`${label}: rpc ${host(p.url)} failed: ${(e as Error).message}`);
			}
		}
	}
	for (const p of explorers) {
		try {
			const parts = [];
			for (const t of topics) parts.push(await explorerLogs(p, config.chain, contract, t, { ...opts, fromBlock: start }));
			const logs = mergeLogs([], parts.flatMap((x) => x.logs));
			const checked = { logs, dropped: parts.reduce((n, x) => n + x.dropped, 0) };
			if (!complete(checked.logs, Math.max(start, ...logs.map((l) => l.blockNumber)))) continue;
			log?.info(`${label}: ${logs.length} logs from ${host(p.url)} (explorer)`);
			if (safe !== undefined) await store(logs, safe, true).catch((e) => log?.warn(`${label}: history not stored: ${(e as Error).message}`));
			return { ...checked, mode: 'full', provider: host(p.url) };
		} catch (e) {
			errors.push(`${host(p.url)}: ${(e as Error).message}`);
			log?.warn(`${label}: explorer ${host(p.url)} failed: ${(e as Error).message}`);
		}
	}
	if (!head || !opts.sql || safe === undefined) {
		throw new Error(`${label}: no endpoint could read the event history (${errors.join('; ').slice(0, 400) || 'no endpoint answered'})`);
	}

	// 2./3. from the stored history (or a seed, or a bootstrap), in ranges the endpoints accept
	const deadline = now() + (opts.budgetMs ?? 50 * 60_000);
	let base: StoredHistory = stored ?? { v: 1, topics, from: start, to: start - 1, complete: false, logs: [] };
	let logs = storedLogs;
	if (!stored && req.seed) {
		const seed = await req.seed(head.head).catch((e) => {
			log?.warn(`${label}: no seed: ${(e as Error).message}`);
			return undefined;
		});
		if (seed && seed.to >= start && seed.to <= head.head) {
			const checked = checkLogs(seed.logs, contract, topics);
			base = { v: 1, topics, from: start, to: seed.to, complete: true, logs: packLogs(checked.logs, topics) };
			logs = checked.logs;
			log?.info(`${label}: history seeded with ${checked.logs.length} known log(s) up to block ${seed.to}; reading on from there`);
		}
	}
	let reached = base.to;
	let served = '';
	for (const p of rpcs) {
		if (reached >= head.head) break;
		try {
			const r = await scanRpc(p, contract, topics, reached + 1, head.head, { ...opts, deadline, now });
			if (r.calls === 0) continue;
			const checked = checkLogs(await toRawLogs(p, r.logs, opts), contract, topics);
			logs = mergeLogs(logs, checked.logs);
			if (r.reached > reached) served ||= host(p.url);
			reached = Math.max(reached, r.reached);
			if (now() > deadline) break;
		} catch (e) {
			errors.push(`${host(p.url)}: ${(e as Error).message}`);
			log?.warn(`${label}: rpc ${host(p.url)} failed: ${(e as Error).message}`);
		}
	}
	const storedTo = Math.min(reached, safe);
	if (storedTo > base.to) {
		await saveHistory(opts.sql, id, {
			v: 1,
			topics,
			from: base.from,
			to: storedTo,
			// complete: the history reached the head once, or started from a seed (gap-free from `from` by construction)
			complete: base.complete || reached >= head.head,
			...(stored?.fullAt ? { fullAt: stored.fullAt } : {}),
			logs: packLogs(
				logs.filter((l) => l.blockNumber <= storedTo),
				topics
			)
		});
	}
	if (reached >= head.head) {
		log?.info(`${label}: ${logs.length} logs (${base.complete ? 'stored history extended' : 'history read'} up to block ${head.head} via ${served || 'stored history'})`);
		return { logs, dropped: 0, mode: base.complete ? 'incremental' : 'bootstrap', provider: served || 'stored' };
	}
	const total = Math.max(1, head.head - start);
	const pct = Math.min(99, Math.floor(((reached - start) / total) * 100));
	throw new HistoryInProgress(
		`${label}: reading the event history in small block ranges, ${pct}% done (block ${reached} of ${head.head}); continues at the next sync${errors.length ? ` (${errors.join('; ').slice(0, 200)})` : ''}`
	);
}

/**
 * The last block at or before `unix` (seconds), by binary search over block
 * timestamps (about 30 eth_getBlockByNumber calls) on the first endpoint that
 * answers.
 */
export async function blockAtTime(config: ChainLogConfig, unix: number, opts: HttpOptions & { logger?: Logger } = {}): Promise<number> {
	const rpcs = config.providers.filter((p) => p.kind === 'rpc');
	const head = await headOf(rpcs, opts, opts.logger);
	if (!head) throw new Error(`${config.chain}: no endpoint answered eth_blockNumber`);
	for (const p of rpcs) {
		try {
			const timeOf = async (bn: number): Promise<number> => {
				const r = await rpc<{ timestamp?: string }>(p, { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [toHex(bn), false] }, opts);
				if (!r.result?.timestamp) throw new Error(errorText(r.error) || 'no block');
				return parseInt(r.result.timestamp, 16);
			};
			let lo = 0;
			let hi = head.head;
			if ((await timeOf(hi)) <= unix) return hi;
			while (lo < hi) {
				const mid = Math.floor((lo + hi + 1) / 2);
				if ((await timeOf(mid)) <= unix) lo = mid;
				else hi = mid - 1;
			}
			return lo;
		} catch (e) {
			opts.logger?.warn(`${config.chain}: block-by-time on ${host(p.url)} failed: ${(e as Error).message}`);
		}
	}
	throw new Error(`${config.chain}: no endpoint could find the block at ${new Date(unix * 1000).toISOString()}`);
}
