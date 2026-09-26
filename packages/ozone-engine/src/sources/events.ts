/**
 * On-chain event sources: stablecoin issuer blacklists and the Chainalysis
 * sanctions oracle. The *events* are the source of truth — each address
 * carries the block time and transaction of its freeze (listedAt / refId)
 * and of its unfreeze or delisting (removedAt).
 *
 * EVM logs come from Etherscan-compatible public explorers that need no API
 * key (Blockscout for Ethereum/Base, Routescan for Avalanche); TRON events
 * from TronGrid. Every sync replays the complete event history, so state is
 * self-healing and never depends on an earlier run.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import type { Category, Risk } from '../../../ozone-client/src/index.js';
import { emptyResult, type ListEntry, type Logger, type ParseResult } from '../types.js';
import { decodeAddressArray, wordToAddress } from '../util/evm.js';
import { httpJson, RateLimiter, type HttpOptions } from '../util/http.js';

export interface LogApi {
	chain: string;
	/** Etherscan-compatible `…/api` base URL. */
	api: string;
	/** Public JSON-RPC endpoints tried first (eth_getLogs with adaptive ranges). */
	rpc?: string[];
	txUrl: (hash: string) => string;
}

export const LOG_APIS: Record<string, LogApi> = {
	ETH: {
		chain: 'ETH',
		api: 'https://eth.blockscout.com/api',
		rpc: ['https://gateway.tenderly.co/public/mainnet', 'https://rpc.mevblocker.io'],
		txUrl: (h) => `https://etherscan.io/tx/${h}`
	},
	BASE: {
		chain: 'BASE',
		api: 'https://base.blockscout.com/api',
		rpc: ['https://gateway.tenderly.co/public/base'],
		txUrl: (h) => `https://basescan.org/tx/${h}`
	},
	AVAX: {
		chain: 'AVAX',
		api: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
		txUrl: (h) => `https://snowtrace.io/tx/${h}`
	}
};

export const TOPICS = {
	AddedBlackList: '0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc',
	RemovedBlackList: '0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c',
	Blacklisted: '0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855',
	UnBlacklisted: '0x117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e',
	BlockPlaced: '0x406bbf2d8d145125adf1198d2cf8a67c66cc4bb0ab01c37dccd4f7c0aae1e7c7',
	BlockReleased: '0x665918c9e02eb2fd85acca3969cb054fc84c138e60ec4af22ab6ef2fd4c93c27',
	SanctionedAddressesAdded: '0x2596d7dd6966c5673f9c06ddb0564c4f0e6d8d206ea075b83ad9ddd71a4fb927',
	SanctionedAddressesRemoved: '0x32aab684eee99db715515d1a9987a8fe33bb6341b0e35e60db7eab48a08f9a3a'
} as const;

export interface RawLog {
	blockNumber: number;
	logIndex: number;
	timeStamp: number;
	transactionHash: string;
	topics: string[];
	data: string;
}

const limiters = new Map<string, RateLimiter>();
function limiterFor(url: string): RateLimiter {
	const host = new URL(url).host;
	let l = limiters.get(host);
	if (!l) {
		l = new RateLimiter(1000, 1);
		limiters.set(host, l);
	}
	return l;
}

const hexOrDec = (v: unknown): number => {
	if (typeof v === 'number') return v;
	const s = String(v ?? '0');
	return s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
};

/** Full history of one event of one contract, oldest first (explorer API). */
export async function fetchLogsExplorer(
	api: LogApi,
	address: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger; maxPages?: number } = {}
): Promise<RawLog[]> {
	const out: RawLog[] = [];
	const seen = new Set<string>();
	let fromBlock = opts.fromBlock ?? 0;
	const maxPages = opts.maxPages ?? 500;
	for (let page = 0; page < maxPages; page++) {
		const url = `${api.api}?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=latest&address=${address}&topic0=${topic0}`;
		const body = await limiterFor(url).run(() => httpJson<{ status?: string; message?: string; result?: unknown }>(url, { retries: 5, ...opts }));
		const result = Array.isArray(body.result) ? (body.result as Array<Record<string, unknown>>) : [];
		if (!Array.isArray(body.result) && body.status !== '0') {
			throw new Error(`${api.chain} logs: unexpected answer ${String(body.message ?? '').slice(0, 80)}`);
		}
		let added = 0;
		let maxBlock = fromBlock;
		for (const r of result) {
			const log: RawLog = {
				blockNumber: hexOrDec(r.blockNumber),
				logIndex: hexOrDec(r.logIndex),
				timeStamp: hexOrDec(r.timeStamp),
				transactionHash: String(r.transactionHash ?? ''),
				topics: ((r.topics as Array<string | null>) ?? []).filter((t): t is string => !!t),
				data: String(r.data ?? '0x')
			};
			const id = `${log.transactionHash}:${log.logIndex}`;
			maxBlock = Math.max(maxBlock, log.blockNumber);
			if (seen.has(id)) continue;
			seen.add(id);
			out.push(log);
			added++;
		}
		// Explorers cap a page (Blockscout 1000, Routescan 100): continue from
		// the last block seen (inclusive) until a page adds nothing new.
		if (added === 0 || result.length < 100) break;
		if (maxBlock === fromBlock && added < result.length) {
			opts.logger?.warn(`${api.chain} logs: more events in block ${fromBlock} than one page can hold`);
			fromBlock = maxBlock + 1;
		} else {
			fromBlock = maxBlock;
		}
	}
	out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
	return out;
}


interface RpcLog {
	blockNumber: string;
	logIndex: string;
	transactionHash: string;
	topics: string[];
	data: string;
	blockTimestamp?: string;
}

async function rpcCall<T>(url: string, body: unknown, opts: HttpOptions): Promise<T> {
	return limiterFor(url).run(() =>
		httpJson<T>(url, {
			...opts,
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
			retries: 1
		})
	);
}

/**
 * eth_getLogs over the whole history with adaptive ranges: start with 5M
 * blocks, halve a range whenever the node refuses it. Block timestamps come
 * from the log (`blockTimestamp`, when the node provides it) or from batched
 * eth_getBlockByNumber calls.
 */
export async function fetchLogsRpc(
	url: string,
	address: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger } = {}
): Promise<RawLog[]> {
	const head = parseInt(
		(await rpcCall<{ result?: string }>(url, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, opts)).result ?? '0x0',
		16
	);
	if (!head) throw new Error(`${url}: no block number`);
	const out: RpcLog[] = [];
	const stack: Array<[number, number]> = [];
	const start = opts.fromBlock ?? 0;
	for (let a = start; a <= head; a += 5_000_000) stack.push([a, Math.min(head, a + 5_000_000 - 1)]);
	stack.reverse();
	let calls = 0;
	while (stack.length) {
		const [a, b] = stack.pop()!;
		if (++calls > 2000) throw new Error(`${url}: too many getLogs calls`);
		const res = await rpcCall<{ result?: RpcLog[]; error?: { message?: string } }>(
			url,
			{ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address, topics: [topic0], fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] },
			opts
		).catch((e: Error) => ({ error: { message: e.message } }) as { result?: RpcLog[]; error?: { message?: string } });
		if (Array.isArray(res.result)) {
			out.push(...res.result);
			continue;
		}
		if (b - a < 2_000) throw new Error(`${url}: eth_getLogs failed on a small range: ${res.error?.message ?? 'no result'}`);
		const mid = Math.floor((a + b) / 2);
		stack.push([mid + 1, b], [a, mid]);
	}
	// timestamps
	const missing = [...new Set(out.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))];
	const ts = new Map<string, number>();
	for (let i = 0; i < missing.length; i += 50) {
		const batch = missing.slice(i, i + 50).map((bn, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getBlockByNumber', params: [bn, false] }));
		const res = await rpcCall<Array<{ id: number; result?: { timestamp?: string } }>>(url, batch, opts);
		for (const r of Array.isArray(res) ? res : []) {
			const bn = missing[i + r.id];
			if (bn && r.result?.timestamp) ts.set(bn, parseInt(r.result.timestamp, 16));
		}
	}
	const logs = out.map((l) => ({
		blockNumber: parseInt(l.blockNumber, 16),
		logIndex: parseInt(l.logIndex, 16),
		timeStamp: l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : (ts.get(l.blockNumber) ?? 0),
		transactionHash: l.transactionHash,
		topics: l.topics,
		data: l.data
	}));
	if (logs.some((l) => !l.timeStamp)) throw new Error(`${url}: missing block timestamps`);
	logs.sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
	opts.logger?.info(`rpc ${new URL(url).host}: ${logs.length} logs in ${calls} getLogs calls`);
	return logs;
}

/** RPC endpoints first, the explorer API as fallback. */
export async function fetchLogs(
	api: LogApi,
	address: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger; maxPages?: number } = {}
): Promise<RawLog[]> {
	for (const url of api.rpc ?? []) {
		try {
			return await fetchLogsRpc(url, address, topic0, opts);
		} catch (e) {
			opts.logger?.warn(`${api.chain} rpc ${new URL(url).host} failed: ${(e as Error).message}`);
		}
	}
	return fetchLogsExplorer(api, address, topic0, opts);
}

interface FreezeEvent {
	kind: 'add' | 'remove';
	address: string; // chain-native form
	chain: string;
	time: number; // unix seconds
	tx: string;
	txUrl: string;
	order: number;
}

export interface EventSourceSpec {
	source: string;
	code: string;
	category: Category;
	risk: Risk;
	entity: string;
	text: (chain: string) => string;
	/** Text once every freeze / listing was lifted. */
	removedText: (chain: string) => string;
	refUrl: string;
}

interface ChainState {
	chain: string;
	address: string;
	addedAt: number;
	addTx: string;
	addTxUrl: string;
	removedAt?: number;
	removeTx?: string;
	removeTxUrl?: string;
}

/**
 * Folds add/remove events (replayed chronologically, per chain) into list
 * entries. One entry per address: active while it is frozen on at least one
 * chain (listedAt = earliest active freeze); removed once every freeze was
 * lifted (removedAt = last release).
 */
export function foldEvents(events: FreezeEvent[], spec: EventSourceSpec): ListEntry[] {
	events.sort((a, b) => a.time - b.time || a.order - b.order);
	const state = new Map<string, Map<string, ChainState>>(); // key → chain → state
	const keyInfo = new Map<string, { address: string }>();
	for (const ev of events) {
		const p = parseForChain(ev.address, ev.chain);
		if (!p) continue;
		keyInfo.set(p.key, { address: p.address });
		let chains = state.get(p.key);
		if (!chains) state.set(p.key, (chains = new Map()));
		const cur = chains.get(ev.chain);
		if (ev.kind === 'add') {
			if (cur && cur.removedAt === undefined) continue; // already frozen here: keep the first freeze
			chains.set(ev.chain, { chain: ev.chain, address: p.address, addedAt: ev.time, addTx: ev.tx, addTxUrl: ev.txUrl });
		} else if (cur && cur.removedAt === undefined) {
			cur.removedAt = ev.time;
			cur.removeTx = ev.tx;
			cur.removeTxUrl = ev.txUrl;
		}
	}
	const out: ListEntry[] = [];
	const iso = (t: number) => new Date(t * 1000).toISOString();
	for (const [key, chains] of state) {
		const all = [...chains.values()];
		if (!all.length) continue;
		const active = all.filter((c) => c.removedAt === undefined).sort((a, b) => a.addedAt - b.addedAt);
		const first = active[0] ?? all.sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0))[0];
		const entry: ListEntry = {
			source: spec.source,
			key,
			chain: first.chain,
			address: keyInfo.get(key)!.address,
			category: spec.category,
			risk: spec.risk,
			code: spec.code,
			entity: spec.entity,
			text: spec.text(active.length ? active.map((c) => c.chain).join(', ') : first.chain),
			refUrl: first.addTxUrl,
			refId: first.addTx,
			listedAt: iso(first.addedAt),
			meta: {
				chains: all.map((c) => ({
					chain: c.chain,
					frozenAt: iso(c.addedAt),
					tx: c.addTx,
					...(c.removedAt !== undefined ? { releasedAt: iso(c.removedAt), releaseTx: c.removeTx } : {})
				}))
			}
		};
		if (!active.length && first.removedAt !== undefined) {
			entry.removedAt = iso(first.removedAt);
			entry.text = spec.removedText(first.chain);
			entry.meta = { ...entry.meta, removedTxUrl: first.removeTxUrl };
		}
		out.push(entry);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Stablecoin issuers
// ---------------------------------------------------------------------------

interface EvmFreezeContract {
	chain: keyof typeof LOG_APIS;
	contract: string;
	add: string;
	remove: string;
	/** Address in topics[1] (indexed) or in data (non-indexed). */
	where: 'topic' | 'data';
}

export const TETHER_EVM: EvmFreezeContract[] = [
	{ chain: 'ETH', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', add: TOPICS.AddedBlackList, remove: TOPICS.RemovedBlackList, where: 'data' },
	{ chain: 'AVAX', contract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', add: TOPICS.BlockPlaced, remove: TOPICS.BlockReleased, where: 'topic' }
];

export const CIRCLE_EVM: EvmFreezeContract[] = [
	{ chain: 'ETH', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' },
	{ chain: 'BASE', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' },
	{ chain: 'AVAX', contract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' }
];

export const TETHER_TRON_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const TRONGRID = 'https://api.trongrid.io';

async function evmFreezeEvents(c: EvmFreezeContract, opts: HttpOptions & { logger?: Logger }): Promise<FreezeEvent[]> {
	const api = LOG_APIS[c.chain];
	const out: FreezeEvent[] = [];
	for (const [kind, topic] of [
		['add', c.add],
		['remove', c.remove]
	] as const) {
		const logs = await fetchLogs(api, c.contract, topic, opts);
		for (const l of logs) {
			const address = c.where === 'topic' ? (l.topics[1] ? wordToAddress(l.topics[1]) : '') : wordToAddress(l.data);
			if (!address || address === '0x0000000000000000000000000000000000000000') continue;
			out.push({
				kind,
				address,
				chain: c.chain,
				time: l.timeStamp,
				tx: l.transactionHash,
				txUrl: api.txUrl(l.transactionHash),
				order: l.blockNumber * 100_000 + l.logIndex
			});
		}
		opts.logger?.info(`${c.chain} ${c.contract.slice(0, 10)} ${kind}: ${logs.length} events`);
	}
	return out;
}

/** TronGrid contract events, oldest first (fingerprint pagination, time-window fallback). */
export async function tronEvents(
	contract: string,
	eventName: string,
	opts: HttpOptions & { logger?: Logger; maxPages?: number } = {}
): Promise<Array<{ user: string; time: number; tx: string; index: number; block: number }>> {
	const out: Array<{ user: string; time: number; tx: string; index: number; block: number }> = [];
	const seen = new Set<string>();
	const limiter = limiterFor(TRONGRID);
	const maxPages = opts.maxPages ?? 1000;
	let minTs = 0;
	let fingerprint: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		let url = `${TRONGRID}/v1/contracts/${contract}/events?event_name=${eventName}&limit=200&order_by=block_timestamp,asc`;
		if (fingerprint) url += `&fingerprint=${encodeURIComponent(fingerprint)}`;
		else if (minTs) url += `&min_block_timestamp=${minTs}`;
		const body = await limiter.run(() =>
			httpJson<{ success?: boolean; data?: Array<Record<string, unknown>>; meta?: { fingerprint?: string } }>(url, opts)
		);
		const data = body.data ?? [];
		let added = 0;
		let lastTs = minTs;
		for (const ev of data) {
			const tx = String(ev.transaction_id ?? '');
			const index = Number(ev.event_index ?? 0);
			const id = `${tx}:${index}`;
			const result = (ev.result ?? {}) as Record<string, string>;
			const user = result._user ?? result['0'] ?? '';
			const time = Number(ev.block_timestamp ?? 0);
			lastTs = Math.max(lastTs, time);
			if (!user || seen.has(id)) continue;
			seen.add(id);
			out.push({ user, time: Math.floor(time / 1000), tx, index, block: Number(ev.block_number ?? 0) });
			added++;
		}
		if (data.length < 200) break;
		if (body.meta?.fingerprint) {
			fingerprint = body.meta.fingerprint;
		} else {
			// window by timestamp (inclusive; duplicates are filtered)
			fingerprint = undefined;
			if (added === 0) break;
			minTs = lastTs;
		}
	}
	opts.logger?.info(`TRON ${contract.slice(0, 8)} ${eventName}: ${out.length} events`);
	return out;
}

export const TETHER_SPEC: EventSourceSpec = {
	source: 'tether',
	code: 'TETHER_FROZEN',
	category: 'stablecoin_freeze',
	risk: 'high',
	entity: 'Tether (USDT issuer)',
	text: (chain) => `USDT frozen by Tether on ${chain} (address blacklisted by the issuer)`,
	removedText: (chain) => `Formerly frozen by Tether on ${chain} — unfrozen by the issuer`,
	refUrl: 'https://tether.to/en/legal/'
};

export const CIRCLE_SPEC: EventSourceSpec = {
	source: 'circle',
	code: 'CIRCLE_BLACKLISTED',
	category: 'stablecoin_freeze',
	risk: 'high',
	entity: 'Circle (USDC issuer)',
	text: (chain) => `USDC blacklisted by Circle on ${chain}`,
	removedText: (chain) => `Formerly blacklisted by Circle on ${chain} — un-blacklisted`,
	refUrl: 'https://www.circle.com/legal/usdc-terms'
};

export const ORACLE_SPEC: EventSourceSpec = {
	source: 'chainalysis_oracle',
	code: 'CHAINALYSIS_ORACLE',
	category: 'sanctions',
	risk: 'severe',
	entity: 'Chainalysis sanctions oracle',
	text: () => 'Sanctioned per the Chainalysis on-chain sanctions oracle (mirror of OFAC SDN EVM addresses)',
	removedText: () => 'Formerly sanctioned per the Chainalysis oracle — removed (delisted)',
	refUrl: 'https://go.chainalysis.com/chainalysis-oracle-docs.html'
};

export const CHAINALYSIS_ORACLE = '0x40C57923924B5c5c5455c48D93317139ADDaC8fb';

export async function syncTether(opts: HttpOptions & { logger?: Logger } = {}): Promise<ParseResult> {
	const events: FreezeEvent[] = [];
	for (const c of TETHER_EVM) events.push(...(await evmFreezeEvents(c, opts)));
	for (const [kind, name] of [
		['add', 'AddedBlackList'],
		['remove', 'RemovedBlackList']
	] as const) {
		for (const e of await tronEvents(TETHER_TRON_CONTRACT, name, opts)) {
			events.push({
				kind,
				address: e.user, // hex 0x… → converted to T… by parseForChain('TRON')
				chain: 'TRON',
				time: e.time,
				tx: e.tx,
				txUrl: `https://tronscan.org/#/transaction/${e.tx}`,
				order: e.block * 100_000 + e.index
			});
		}
	}
	const res = emptyResult();
	res.entries = foldEvents(events, TETHER_SPEC);
	res.version = `events:${events.length}`;
	return res;
}

export async function syncCircle(opts: HttpOptions & { logger?: Logger } = {}): Promise<ParseResult> {
	const events: FreezeEvent[] = [];
	for (const c of CIRCLE_EVM) events.push(...(await evmFreezeEvents(c, opts)));
	const res = emptyResult();
	res.entries = foldEvents(events, CIRCLE_SPEC);
	res.version = `events:${events.length}`;
	return res;
}

export async function syncChainalysisOracle(opts: HttpOptions & { logger?: Logger } = {}): Promise<ParseResult> {
	const api = LOG_APIS.ETH;
	const events: FreezeEvent[] = [];
	for (const [kind, topic] of [
		['add', TOPICS.SanctionedAddressesAdded],
		['remove', TOPICS.SanctionedAddressesRemoved]
	] as const) {
		const logs = await fetchLogs(api, CHAINALYSIS_ORACLE, topic, opts);
		for (const l of logs) {
			decodeAddressArray(l.data).forEach((address, i) =>
				events.push({
					kind,
					address,
					chain: 'ETH',
					time: l.timeStamp,
					tx: l.transactionHash,
					txUrl: api.txUrl(l.transactionHash),
					order: l.blockNumber * 100_000 + l.logIndex * 1000 + i
				})
			);
		}
	}
	const res = emptyResult();
	res.entries = foldEvents(events, ORACLE_SPEC);
	res.version = `events:${events.length}`;
	return res;
}
