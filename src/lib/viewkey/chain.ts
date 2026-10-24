/**
 * Public chain reads for the view-key page, straight from CometBFT RPCs (GET only; no node of
 * Redacted's network is needed). The bulk feeds are the proxy's own paged queries at one pinned height,
 * exactly as a Redacted node serves them (relayer-node-hops `src/hops/node/feeds.ts`): the same
 * query shapes, record lists, cursors and page limits, so `snapshotFromFeeds` reads them unchanged.
 *
 * Every request carries only public values: a contract address, a feed query with a cursor, a block
 * height, or an address the view-key file lists. Never the file, nor any value of it but addresses.
 */
import type { ChainSource } from './config';
import { MAX_TIP_SPREAD } from './config';
import { allBalancesRequest, allBalancesResponse, base64ToBytes, hex, smartQueryRequest, smartQueryResponse } from './proto';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ChainError extends Error {
	constructor(
		readonly code: 'CHAIN_UNAVAILABLE' | 'CHAIN_MISMATCH' | 'REPLAY' | 'SOURCES_DISAGREE',
		message: string
	) {
		super(message);
		this.name = 'ChainError';
	}
}

/** The platform's fetch, called as a free function at call time (tests replace `globalThis.fetch`). */
export const platformFetch: FetchFn = (url, init) => globalThis.fetch(url, init);

const GET: RequestInit = { method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' };

/** E-59: the most pages one feed follows. */
export const FEED_MAX_PAGES = 10_000;

type Cursor = string | number | undefined;
interface FeedSpec {
	query(from: Cursor, limit: number, denom?: string): Record<string, unknown>;
	list: string;
	cursor(record: unknown): Cursor;
	limit: number;
}

const field =
	(...path: string[]) =>
	(record: unknown): Cursor => {
		let cur: unknown = record;
		for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
		return typeof cur === 'string' || typeof cur === 'number' ? cur : undefined;
	};
const u64 = (from: Cursor) => (from === undefined ? null : Number(from));
const str = (from: Cursor) => (from === undefined ? null : String(from));

/** The node's FEEDS (relayer-node-hops feeds.ts), read here from the proxy directly. */
export const FEEDS = {
	notes: { query: (from, limit) => ({ notes: { start_after: u64(from), limit } }), list: 'notes', cursor: field('index'), limit: 200 },
	nullifiers: { query: (from, limit) => ({ nullifiers: { start_after: u64(from), limit } }), list: 'nullifiers', cursor: field('record', 'sequence'), limit: 500 },
	deposits: { query: (from, limit) => ({ pending_deposits: { start_after: u64(from), limit } }), list: 'pending', cursor: field('id'), limit: 100 },
	accounts: { query: (from, limit) => ({ accounts: { start_after: str(from), limit } }), list: 'accounts', cursor: field('address'), limit: 100 },
	headers: { query: (from, limit) => ({ headers: { start_after: str(from), limit } }), list: 'headers', cursor: field('tau'), limit: 100 },
	slow: { query: (from, limit) => ({ slows: { start_after: str(from), limit } }), list: 'requests', cursor: field('nf'), limit: 100 },
	queue: {
		query: (from, limit, denom) => ({ queue: { denom, start_after: u64(from), limit } }),
		list: 'items',
		cursor: (r: unknown) => field('seq')(r) ?? field('id')(r),
		limit: 100
	}
} satisfies Record<string, FeedSpec>;
export type FeedKind = keyof typeof FEEDS;

/** WP-E's `FeedRecords` (vault-sdk `types.ts`): every feed's records at one height. */
export interface FeedRecords {
	height: number;
	notes: unknown[];
	nullifiers: unknown[];
	headers: unknown[];
	accounts: unknown[];
	slow: unknown[];
	queue: unknown[];
	deposits: unknown[];
	openings: unknown[];
}

export interface Tip {
	height: number;
	network: string;
}

/** A payout the proxy made (event `hops_spend` or `hops_exit`): the nullifiers it spent and whom it paid. */
export interface SpendEvent {
	type: 'spend' | 'exit';
	height: number;
	kind: string;
	nullifiers: string[];
	recipient: string;
	denom?: string;
	amount?: string;
}

/** A deposit into the proxy (event `hops_deposit`): the note commitment it makes and its sender. */
export interface DepositEvent {
	height: number;
	cm: string;
	source: string;
	denom?: string;
	amount?: string;
}

/** What the proxy's own events add to a view: depositors and payees. */
export interface ProxyFacts {
	from: number;
	to: number;
	deposits: DepositEvent[];
	spends: SpendEvent[];
}

/** One transaction that executed a Spending account (a sub-wallet contract): what left it, and whom it called. */
export interface ActivityTx {
	height: number;
	hash: string;
	sent: { recipient: string; amount: string }[];
	called: string[];
}

/** The most pages (of 100 transactions) one history read follows; more is reported, not read. */
export const TX_MAX_PAGES = 50;

export class SourceReader {
	constructor(
		readonly source: ChainSource,
		private readonly fetchFn: FetchFn = platformFetch
	) {}

	private async rpc(path: string, params: Record<string, string>): Promise<any> {
		const q = Object.entries(params)
			.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
			.join('&');
		const url = `${this.source.rpc}${path}${q ? '?' + q : ''}`;
		let r: Response;
		try {
			r = await this.fetchFn(url, GET);
		} catch {
			throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name} cannot be reached`);
		}
		if (!r.ok) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name} answered ${r.status}`);
		let body: any;
		try {
			body = await r.json();
		} catch {
			throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name} answered no JSON`);
		}
		if (body?.error) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name}: ${String(body.error?.data ?? body.error?.message ?? 'error').slice(0, 160)}`);
		return body?.result;
	}

	async tip(): Promise<Tip> {
		const s = await this.rpc('/status', {});
		const height = Number(s?.sync_info?.latest_block_height);
		const network = String(s?.node_info?.network ?? '');
		if (!Number.isSafeInteger(height) || height <= 0) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name} reports no height`);
		if (s?.sync_info?.catching_up === true) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name} is catching up`);
		return { height, network };
	}

	private async abci(path: string, data: Uint8Array, height: number): Promise<Uint8Array> {
		const res = await this.rpc('/abci_query', { path: `"${path}"`, data: '0x' + hex(data), height: String(height), prove: 'false' });
		const resp = res?.response;
		if (!resp || Number(resp.code) !== 0) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name}: query refused (${String(resp?.log ?? resp?.code ?? '?').slice(0, 160)})`);
		if (resp.height !== undefined && Number(resp.height) !== height) throw new ChainError('REPLAY', `${this.source.name} answered height ${resp.height} for ${height}`);
		return base64ToBytes(String(resp.value ?? ''));
	}

	/** A smart query of `contract` at `height`. */
	async smartAt(contract: string, msg: unknown, height: number): Promise<unknown> {
		const bytes = await this.abci('/cosmwasm.wasm.v1.Query/SmartContractState', smartQueryRequest(contract, msg), height);
		try {
			return smartQueryResponse(bytes);
		} catch {
			throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name}: unreadable answer`);
		}
	}

	/** Every page of one feed at `height` (E-59: no oversize page, a moving cursor, a bounded number of pages). */
	async feedAll(proxy: string, kind: FeedKind, height: number, denom?: string): Promise<unknown[]> {
		const spec: FeedSpec = FEEDS[kind];
		const out: unknown[] = [];
		let from: Cursor = undefined;
		const seen = new Set<string>();
		for (let page = 0; page < FEED_MAX_PAGES; page++) {
			const answer = (await this.smartAt(proxy, spec.query(from, spec.limit, denom), height)) as Record<string, unknown> | null;
			const records = answer && Array.isArray(answer[spec.list]) ? (answer[spec.list] as unknown[]) : null;
			if (!records) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name}: the ${kind} feed answered no list`);
			if (records.length > spec.limit) throw new ChainError('REPLAY', `${this.source.name}: a ${kind} page of more records than asked (E-59)`);
			out.push(...records);
			if (records.length < spec.limit) return out;
			const next = spec.cursor(records[records.length - 1]);
			if (next === undefined || next === from || seen.has(String(next))) throw new ChainError('REPLAY', `${this.source.name}: the ${kind} cursor does not move (E-59)`);
			seen.add(String(next));
			from = next;
		}
		throw new ChainError('REPLAY', `${this.source.name}: the ${kind} feed has more than ${FEED_MAX_PAGES} pages (E-59)`);
	}

	/** The proxy's denominations (`denoms {}`), for the per-denomination queue feed. */
	async denoms(proxy: string, height: number): Promise<string[]> {
		const answer = (await this.smartAt(proxy, { denoms: {} }, height)) as { denoms?: { config?: { denom?: unknown } }[] } | null;
		const list = (answer?.denoms ?? []).map((d) => d?.config?.denom).filter((d): d is string => typeof d === 'string' && /^[a-z][a-z0-9/:._-]{1,127}$/.test(d));
		return [...new Set(list)].sort();
	}

	/** Every feed a view replay reads, at `height`. The `openings` feed is a node index (none here). */
	async feedRecords(proxy: string, height: number, denoms?: string[]): Promise<FeedRecords> {
		const ds = denoms ?? (await this.denoms(proxy, height));
		const r: FeedRecords = { height, notes: [], nullifiers: [], headers: [], accounts: [], slow: [], queue: [], deposits: [], openings: [] };
		r.notes = await this.feedAll(proxy, 'notes', height);
		r.nullifiers = await this.feedAll(proxy, 'nullifiers', height);
		r.headers = await this.feedAll(proxy, 'headers', height);
		r.accounts = await this.feedAll(proxy, 'accounts', height);
		r.slow = await this.feedAll(proxy, 'slow', height);
		r.deposits = await this.feedAll(proxy, 'deposits', height);
		for (const d of ds) r.queue.push(...(await this.feedAll(proxy, 'queue', height, d)));
		return r;
	}

	/** An address's bank balances at `height`. */
	async balancesAt(address: string, height: number): Promise<{ denom: string; amount: string }[]> {
		const bytes = await this.abci('/cosmos.bank.v1beta1.Query/AllBalances', allBalancesRequest(address), height);
		try {
			return allBalancesResponse(bytes);
		} catch {
			throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name}: unreadable balances`);
		}
	}

	/** One page of `tx_search` (CometBFT; only indexed keys: `execute._contract_address` and `tx.height` here). */
	async txSearch(query: string, page: number): Promise<{ txs: any[]; total: number }> {
		const res = await this.rpc('/tx_search', { query: `"${query}"`, page: String(page), per_page: '100', order_by: '"asc"' });
		const txs = Array.isArray(res?.txs) ? res.txs : [];
		const total = Number(res?.total_count ?? 0);
		if (!Number.isSafeInteger(total) || total < 0) throw new ChainError('CHAIN_UNAVAILABLE', `${this.source.name}: unreadable search answer`);
		return { txs, total };
	}

	/**
	 * Every transaction that executed `contract` in [from, to], oldest first: a bulk read that names the
	 * contract and a height range only. Null when it has more than `TX_MAX_PAGES` pages.
	 */
	async executions(contract: string, from: number, to: number): Promise<any[] | null> {
		const query = `execute._contract_address='${contract}' AND tx.height>=${from} AND tx.height<=${to}`;
		const out: any[] = [];
		for (let page = 1; page <= TX_MAX_PAGES; page++) {
			const { txs, total } = await this.txSearch(query, page);
			out.push(...txs);
			if (out.length >= total || txs.length === 0) return out;
		}
		return null;
	}
}

const attr = (e: any): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const a of Array.isArray(e?.attributes) ? e.attributes : []) {
		if (typeof a?.key === 'string' && typeof a?.value === 'string' && !(a.key in out)) out[a.key] = a.value;
	}
	return out;
};

const okTxs = (txs: any[]) => txs.filter((t) => Number(t?.tx_result?.code ?? 0) === 0);
const eventsOf = (t: any): any[] => (Array.isArray(t?.tx_result?.events) ? t.tx_result.events : []);

/** Depositors and payees from the proxy's own events in `txs` (successful transactions only; other contracts' events ignored). */
export function proxyFactsOf(txs: any[], proxy: string, from: number, to: number): ProxyFacts {
	const facts: ProxyFacts = { from, to, deposits: [], spends: [] };
	for (const t of okTxs(txs)) {
		const height = Number(t.height);
		for (const e of eventsOf(t)) {
			if (e?.type !== 'wasm-hops_spend' && e?.type !== 'wasm-hops_exit' && e?.type !== 'wasm-hops_deposit') continue;
			const a = attr(e);
			if (a._contract_address !== proxy) continue;
			if (e.type === 'wasm-hops_deposit') {
				if (/^[0-9a-f]{64}$/.test(a.cm ?? '') && a.source) facts.deposits.push({ height, cm: a.cm!, source: a.source, denom: a.denom, amount: a.amount });
				continue;
			}
			const nullifiers = (a.nullifiers ?? '').split(',').filter((x) => /^[0-9a-f]{64}$/.test(x));
			if (e.type === 'wasm-hops_spend') facts.spends.push({ type: 'spend', height, kind: a.kind ?? '', nullifiers, recipient: a.recipient ?? '', denom: a.denom, amount: a.amount });
			else facts.spends.push({ type: 'exit', height, kind: a.destination ?? 'exit', nullifiers, recipient: a.to ?? '' });
		}
	}
	return facts;
}

/** What a Spending account did in `txs`: transfers out of it, and the contracts it called. */
export function activityOf(txs: any[], account: string): ActivityTx[] {
	const out: ActivityTx[] = [];
	for (const t of okTxs(txs)) {
		const sent: ActivityTx['sent'] = [];
		const called = new Set<string>();
		for (const e of eventsOf(t)) {
			const a = attr(e);
			if (e?.type === 'transfer' && a.sender === account && a.recipient && a.amount) sent.push({ recipient: a.recipient, amount: a.amount });
			if (e?.type === 'execute' && a._contract_address && a._contract_address !== account) called.add(a._contract_address);
		}
		out.push({ height: Number(t.height), hash: String(t.hash ?? ''), sent, called: [...called] });
	}
	return out;
}

/**
 * Two independent sources (C5): both must be on the deployment's chain, their tips within
 * `MAX_TIP_SPREAD` blocks; the pinned height is the lower tip (both can serve it), the tip the page
 * reports to the viewer (E-48) the higher one.
 */
export class ChainPair {
	readonly readers: [SourceReader, SourceReader];
	private pinned: number | null = null;
	constructor(
		sources: readonly [ChainSource, ChainSource],
		readonly chainId: string,
		readonly proxy: string,
		fetchFn: FetchFn = platformFetch
	) {
		this.readers = [new SourceReader(sources[0], fetchFn), new SourceReader(sources[1], fetchFn)];
	}

	/** Both tips; sets the pinned height. Returns the higher tip (the viewer's E-48 floor). */
	async tip(): Promise<number> {
		const tips = await Promise.all(this.readers.map((r) => r.tip()));
		for (const [i, t] of tips.entries()) {
			if (t.network !== this.chainId) throw new ChainError('CHAIN_MISMATCH', `${this.readers[i]!.source.name} serves ${t.network}, not ${this.chainId}`);
		}
		const hi = Math.max(tips[0]!.height, tips[1]!.height);
		const lo = Math.min(tips[0]!.height, tips[1]!.height);
		if (hi - lo > MAX_TIP_SPREAD) throw new ChainError('SOURCES_DISAGREE', `the two chain sources are ${hi - lo} blocks apart`);
		this.pinned = lo;
		return hi;
	}

	get height(): number | null {
		return this.pinned;
	}

	private async at(): Promise<number> {
		if (this.pinned === null) await this.tip();
		return this.pinned!;
	}

	/** The feeds of both sources at the pinned height (the viewer cross-checks them, C5). */
	async feedRecords(): Promise<[FeedRecords, FeedRecords]> {
		const h = await this.at();
		const denoms = await this.readers[0].denoms(this.proxy, h);
		const other = await this.readers[1].denoms(this.proxy, h);
		if (JSON.stringify(denoms) !== JSON.stringify(other)) throw new ChainError('SOURCES_DISAGREE', 'the two chain sources list different denominations');
		return Promise.all(this.readers.map((r) => r.feedRecords(this.proxy, h, denoms))) as Promise<[FeedRecords, FeedRecords]>;
	}

	/** An address's balances, the same from both sources. */
	async balances(address: string): Promise<{ denom: string; amount: string }[]> {
		const h = await this.at();
		const [a, b] = await Promise.all(this.readers.map((r) => r.balancesAt(address, h)));
		if (JSON.stringify(a) !== JSON.stringify(b)) throw new ChainError('SOURCES_DISAGREE', `the two chain sources disagree on the balances of ${address}`);
		return a!;
	}

	/** Depositors and payees in [from, to], the same from both sources (null: too much history to read). */
	async proxyFacts(from: number): Promise<ProxyFacts | null> {
		const to = await this.at();
		const lo = Math.max(1, Math.min(from, to));
		const [a, b] = await Promise.all(this.readers.map((r) => r.executions(this.proxy, lo, to)));
		if (a === null || b === null) return null;
		const fa = proxyFactsOf(a, this.proxy, lo, to);
		if (JSON.stringify(fa) !== JSON.stringify(proxyFactsOf(b, this.proxy, lo, to))) throw new ChainError('SOURCES_DISAGREE', 'the two chain sources disagree on the proxy\'s history');
		return fa;
	}

	/** A listed Spending account's transactions in [from, to], the same from both sources (null: too many). */
	async activity(account: string, from: number): Promise<ActivityTx[] | null> {
		const to = await this.at();
		const lo = Math.max(1, Math.min(from, to));
		const [a, b] = await Promise.all(this.readers.map((r) => r.executions(account, lo, to)));
		if (a === null || b === null) return null;
		const xa = activityOf(a, account);
		if (JSON.stringify(xa) !== JSON.stringify(activityOf(b, account))) throw new ChainError('SOURCES_DISAGREE', `the two chain sources disagree on the history of ${account}`);
		return xa;
	}
}
