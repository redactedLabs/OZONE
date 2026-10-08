/**
 * On-chain event sources: stablecoin issuer blacklists and the Chainalysis
 * sanctions oracle. The *events* are the source of truth — each address
 * carries the block time and transaction of its freeze (listedAt / refId)
 * and of its unfreeze or delisting (removedAt).
 *
 * EVM logs come from keyless public JSON-RPC endpoints with failover and
 * block-range adaptation, explorers (Etherscan-compatible: Blockscout,
 * Routescan, the Optimism explorer) as the fallback, and a stored history
 * for chains where no keyless endpoint can replay the whole history in a few
 * calls (Base) — see evmlogs.ts. TRON events come from TronGrid. Every sync
 * replays the complete event history where an endpoint allows it, so state is
 * self-healing and never depends on an earlier run.
 *
 * Chains beyond the original ones (ETH/TRON/AVAX for Tether, ETH/BASE/AVAX
 * for Circle, ETH for the oracle) are separate sources, so an outage on one
 * of them can never fail — or, worse, half-delist — a core source.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import type { Category, Risk } from '../../../ozone-client/src/index.js';
import { emptyResult, type ListEntry, type Logger, type ParseResult, type Sql } from '../types.js';
import { decodeAddressArray, wordToAddress } from '../util/evm.js';
import { httpJson, type HttpOptions } from '../util/http.js';
import {
	blockAtTime,
	explorerLogs,
	limiterFor,
	readContractLogs,
	type ChainLogConfig,
	type ContractLogsRequest,
	type ContractLogsOptions,
	type LogProvider,
	type LogsResult,
	type RawLog
} from './evmlogs.js';

export type { RawLog, LogsResult } from './evmlogs.js';

export interface LogApi {
	chain: string;
	/** Etherscan-compatible `…/api` base URL (the chain's own explorer). */
	api: string;
	/** Public JSON-RPC endpoints, tried before the explorer (see EVM_LOG_RPCS for their limits). */
	rpc?: string[];
	txUrl: (hash: string) => string;
}

/**
 * Keyless public JSON-RPC endpoints per chain, best first, with what was
 * measured on 2026-10-07 (eth_getLogs over a contract's whole history):
 * Tenderly's public gateways replay whole histories on Ethereum, Arbitrum,
 * Optimism, Polygon and Avalanche (with block timestamps, except Avalanche),
 * but serve 1,000 blocks per call on Base; the official Optimism RPC replays
 * whole histories, Arbitrum's 10M blocks per call, Avalanche's 5M; thirdweb
 * serves 1,000, base.org 500; PublicNode wants a token for history on Base,
 * Arbitrum and Optimism and serves 10,000 (Polygon) or 50,000 (Avalanche)
 * blocks per call. dRPC's free tier refuses even 1,000-block ranges (its
 * message says "ranges over 10000 blocks") and is not used. No keyless
 * endpoint replays Base: its history is stored and extended (evmlogs.ts).
 */
export const EVM_LOG_RPCS: Record<string, LogProvider[]> = {
	ETH: [
		{ kind: 'rpc', url: 'https://gateway.tenderly.co/public/mainnet', minIntervalMs: 250 },
		{ kind: 'rpc', url: 'https://rpc.mevblocker.io', minIntervalMs: 500 },
		{ kind: 'rpc', url: 'https://1.rpc.thirdweb.com', maxRange: 1_000, minIntervalMs: 300 }
	],
	BASE: [
		{ kind: 'rpc', url: 'https://gateway.tenderly.co/public/base', maxRange: 1_000, minIntervalMs: 250 },
		{ kind: 'rpc', url: 'https://8453.rpc.thirdweb.com', maxRange: 1_000, minIntervalMs: 300 },
		{ kind: 'rpc', url: 'https://mainnet.base.org', maxRange: 500, minIntervalMs: 500 }
	],
	AVAX: [
		{ kind: 'rpc', url: 'https://gateway.tenderly.co/public/avalanche', minIntervalMs: 250 },
		{ kind: 'rpc', url: 'https://api.avax.network/ext/bc/C/rpc', maxRange: 5_000_000, minIntervalMs: 500 },
		{ kind: 'rpc', url: 'https://avalanche-c-chain-rpc.publicnode.com', maxRange: 50_000, minIntervalMs: 500 }
	],
	ARB: [
		{ kind: 'rpc', url: 'https://gateway.tenderly.co/public/arbitrum', minIntervalMs: 250 },
		{ kind: 'rpc', url: 'https://arb1.arbitrum.io/rpc', maxRange: 10_000_000, minIntervalMs: 500 },
		{ kind: 'rpc', url: 'https://42161.rpc.thirdweb.com', maxRange: 1_000, minIntervalMs: 300 }
	],
	OP: [
		{ kind: 'rpc', url: 'https://mainnet.optimism.io', minIntervalMs: 500 },
		{ kind: 'rpc', url: 'https://gateway.tenderly.co/public/optimism', minIntervalMs: 250 },
		{ kind: 'rpc', url: 'https://10.rpc.thirdweb.com', maxRange: 1_000, minIntervalMs: 300 }
	],
	POL: [
		{ kind: 'rpc', url: 'https://gateway.tenderly.co/public/polygon', minIntervalMs: 250 },
		{ kind: 'rpc', url: 'https://polygon-bor-rpc.publicnode.com', maxRange: 10_000, minIntervalMs: 500 },
		{ kind: 'rpc', url: 'https://137.rpc.thirdweb.com', maxRange: 1_000, minIntervalMs: 300 }
	]
};

export const LOG_APIS: Record<string, LogApi> = {
	ETH: {
		chain: 'ETH',
		api: 'https://eth.blockscout.com/api',
		rpc: EVM_LOG_RPCS.ETH.map((p) => p.url),
		txUrl: (h) => `https://etherscan.io/tx/${h}`
	},
	BASE: {
		chain: 'BASE',
		api: 'https://base.blockscout.com/api',
		rpc: EVM_LOG_RPCS.BASE.map((p) => p.url),
		txUrl: (h) => `https://basescan.org/tx/${h}`
	},
	AVAX: {
		chain: 'AVAX',
		api: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
		rpc: EVM_LOG_RPCS.AVAX.map((p) => p.url),
		txUrl: (h) => `https://snowtrace.io/tx/${h}`
	},
	ARB: {
		chain: 'ARB',
		api: 'https://arbitrum.blockscout.com/api',
		rpc: EVM_LOG_RPCS.ARB.map((p) => p.url),
		txUrl: (h) => `https://arbitrum.blockscout.com/tx/${h}`
	},
	OP: {
		chain: 'OP',
		api: 'https://explorer.optimism.io/api',
		rpc: EVM_LOG_RPCS.OP.map((p) => p.url),
		txUrl: (h) => `https://explorer.optimism.io/tx/${h}`
	},
	POL: {
		chain: 'POL',
		api: 'https://polygon.blockscout.com/api',
		rpc: EVM_LOG_RPCS.POL.map((p) => p.url),
		txUrl: (h) => `https://polygon.blockscout.com/tx/${h}`
	}
};

/** Blocks at the head re-read on every sync and never stored (about 10–15 minutes of each chain). */
const FINALITY: Record<string, number> = { ETH: 64, BASE: 450, AVAX: 450, ARB: 3_600, OP: 450, POL: 512 };

/** Explorers after the chain's own: Routescan answers keyless for Ethereum (and is Avalanche's own). */
const MORE_EXPLORERS: Record<string, string[]> = { ETH: ['https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api'] };

/**
 * The endpoints for a chain's logs: its RPCs, then its explorer(s); the
 * Blockscout PRO API before a keyless Blockscout instance when
 * BLOCKSCOUT_API_KEY is set (an owner's key: nothing is sent without it).
 */
export function chainLogConfig(chain: string, env: Record<string, string | undefined> = process.env): ChainLogConfig {
	const api = LOG_APIS[chain];
	if (!api) throw new Error(`no log endpoints for ${chain}`);
	const rpcs: LogProvider[] = (api.rpc ?? []).map((url) => EVM_LOG_RPCS[chain]?.find((p) => p.url === url) ?? { kind: 'rpc', url, minIntervalMs: 500 });
	const explorers: LogProvider[] = [];
	const chainIds: Record<string, string> = { ETH: '1', OP: '10', POL: '137', BASE: '8453', ARB: '42161', AVAX: '43114' };
	const isBlockscout = api.api.includes('blockscout.com');
	if (isBlockscout && env.BLOCKSCOUT_API_KEY && chainIds[chain]) {
		explorers.push({ kind: 'explorer', url: 'https://api.blockscout.com/v2/api', minIntervalMs: 250, params: { chain_id: chainIds[chain], apikey: env.BLOCKSCOUT_API_KEY } });
	}
	explorers.push({ kind: 'explorer', url: api.api, minIntervalMs: 1000 });
	for (const url of MORE_EXPLORERS[chain] ?? []) explorers.push({ kind: 'explorer', url, minIntervalMs: 600 });
	return { chain, providers: [...rpcs, ...explorers], finality: FINALITY[chain] ?? 450, txUrl: api.txUrl };
}

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

export type EventSyncOptions = HttpOptions & Pick<ContractLogsOptions, 'logger' | 'sql' | 'budgetMs' | 'now'> & { env?: Record<string, string | undefined> };

/** Full history of one event of one contract, oldest first (explorer API). */
export async function fetchLogsExplorer(
	api: LogApi,
	address: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger; maxPages?: number } = {}
): Promise<LogsResult> {
	return explorerLogs({ kind: 'explorer', url: api.api, minIntervalMs: 1000 }, api.chain, address, topic0, opts);
}

/**
 * eth_getLogs over the whole history of one endpoint, in ranges it accepts
 * (learned from its refusals, halved on others). Block timestamps come from
 * the log (`blockTimestamp`) or from eth_getBlockByNumber.
 */
export async function fetchLogsRpc(
	url: string,
	address: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger } = {}
): Promise<LogsResult> {
	const config: ChainLogConfig = { chain: 'EVM', providers: [{ kind: 'rpc', url, minIntervalMs: 1000 }], finality: 0, txUrl: (h) => h };
	const r = await readContractLogs({ config, contract: address, topics: [topic0], fromBlock: opts.fromBlock }, { ...opts, sql: undefined });
	return { logs: r.logs, dropped: r.dropped };
}

/** RPC endpoints first, the explorer API as fallback (whole history, no stored state). */
export async function fetchLogs(
	api: LogApi,
	address: string,
	topic0: string,
	opts: HttpOptions & { fromBlock?: number; logger?: Logger; maxPages?: number } = {}
): Promise<LogsResult> {
	const config: ChainLogConfig = {
		chain: api.chain,
		providers: [...(api.rpc ?? []).map((url): LogProvider => ({ kind: 'rpc', url, minIntervalMs: 500 })), { kind: 'explorer', url: api.api, minIntervalMs: 1000 }],
		finality: 0,
		txUrl: api.txUrl
	};
	const r = await readContractLogs({ config, contract: address, topics: [topic0], fromBlock: opts.fromBlock }, { ...opts, sql: undefined });
	return { logs: r.logs, dropped: r.dropped };
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
	/** Deployment block (nothing to read before it; matters where the history is read in small ranges). */
	fromBlock?: number;
}

export const TETHER_EVM: EvmFreezeContract[] = [
	{ chain: 'ETH', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', add: TOPICS.AddedBlackList, remove: TOPICS.RemovedBlackList, where: 'data' },
	{ chain: 'AVAX', contract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', add: TOPICS.BlockPlaced, remove: TOPICS.BlockReleased, where: 'topic' }
];

export const CIRCLE_EVM: EvmFreezeContract[] = [
	{ chain: 'ETH', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' },
	// deployed in block 2,797,221 (first block with code, eth_getCode 2026-10-07)
	{ chain: 'BASE', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic', fromBlock: 2_797_221 },
	{ chain: 'AVAX', contract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' }
];

/** Circle's native USDC on further chains (same FiatToken Blacklisted/UnBlacklisted events). */
export const CIRCLE_OTHER_EVM: EvmFreezeContract[] = [
	{ chain: 'ARB', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' },
	{ chain: 'OP', contract: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' },
	{ chain: 'POL', contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', add: TOPICS.Blacklisted, remove: TOPICS.UnBlacklisted, where: 'topic' }
];

/**
 * USDT0 — Tether's omnichain USDT (LayerZero OFT) on Arbitrum and the
 * upgraded USDT on Polygon PoS: BlockPlaced / BlockReleased(address indexed),
 * the same events as Tether's Avalanche contract (verified on Blockscout,
 * 2026-09-27: 37 freezes on Arbitrum, 5 freezes and 1 release on Polygon).
 */
export const USDT0_EVM: EvmFreezeContract[] = [
	{ chain: 'ARB', contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', add: TOPICS.BlockPlaced, remove: TOPICS.BlockReleased, where: 'topic' },
	{ chain: 'POL', contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', add: TOPICS.BlockPlaced, remove: TOPICS.BlockReleased, where: 'topic' }
];

export const TETHER_TRON_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const TRONGRID = 'https://api.trongrid.io';

const word = (addr: string) => '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');

/**
 * A seed for a contract's stored history (readContractLogs): the state the
 * source last published for `chain` — every address's freeze (and release)
 * on that chain, from its own entries — up to the block one hour before that
 * successful sync. Where no keyless endpoint can replay a chain's history
 * (Base since 2026-10-06), this replaces reading tens of thousands of
 * 1,000-block ranges; folding the seed and the logs read after it gives the
 * same entries as folding the whole history (only each address's last
 * freeze and release count).
 */
function entriesSeed(
	opts: EventSyncOptions,
	source: string,
	config: ChainLogConfig,
	contract: string,
	encode: (kind: 'add' | 'remove', address: string) => { topics: string[]; data: string }
): ContractLogsRequest['seed'] {
	const sql = opts.sql;
	if (!sql) return undefined;
	return async () => {
		const src = (await sql.query<{ last_success_at: string | Date | null }>(`SELECT last_success_at FROM oz_sources WHERE id = $1`, [source])).rows[0];
		if (!src?.last_success_at) return undefined;
		const rows = (await sql.query<{ address: string; meta: unknown }>(`SELECT address, meta FROM oz_entries WHERE source = $1`, [source])).rows;
		const logs: RawLog[] = [];
		let i = 0;
		const push = (kind: 'add' | 'remove', address: string, at: string | undefined, tx: string | undefined) => {
			const t = at ? Math.floor(Date.parse(at) / 1000) : NaN;
			if (!Number.isFinite(t) || !tx) return;
			const e = encode(kind, address);
			logs.push({ blockNumber: 0, logIndex: i++, timeStamp: t, transactionHash: tx, address: contract, topics: e.topics, data: e.data });
		};
		for (const r of rows) {
			const meta = (typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta) as { chains?: Array<{ chain?: string; frozenAt?: string; tx?: string; releasedAt?: string; releaseTx?: string }> } | null;
			for (const c of meta?.chains ?? []) {
				if (c.chain !== config.chain) continue;
				push('add', r.address, c.frozenAt, c.tx);
				if (c.releasedAt) push('remove', r.address, c.releasedAt, c.releaseTx);
			}
		}
		const to = await blockAtTime(config, Math.floor(new Date(src.last_success_at).getTime() / 1000) - 3600, opts);
		return { logs, to };
	};
}

async function evmFreezeEvents(c: EvmFreezeContract, opts: EventSyncOptions, source: string): Promise<{ events: FreezeEvent[]; dropped: number }> {
	const config = chainLogConfig(c.chain, opts.env);
	const seed = entriesSeed(opts, source, config, c.contract, (kind, address) => {
		const topic0 = kind === 'add' ? c.add : c.remove;
		return c.where === 'topic' ? { topics: [topic0, word(address)], data: '0x' } : { topics: [topic0], data: word(address) };
	});
	const { logs, dropped } = await readContractLogs({ config, contract: c.contract, topics: [c.add, c.remove], fromBlock: c.fromBlock, seed }, opts);
	const out: FreezeEvent[] = [];
	const counts = { add: 0, remove: 0 };
	for (const l of logs) {
		const kind = (l.topics[0] ?? '').toLowerCase() === c.add.toLowerCase() ? 'add' : 'remove';
		counts[kind]++;
		const address = c.where === 'topic' ? (l.topics[1] ? wordToAddress(l.topics[1]) : '') : wordToAddress(l.data);
		if (!address || address === '0x0000000000000000000000000000000000000000') continue;
		out.push({
			kind,
			address,
			chain: c.chain,
			time: l.timeStamp,
			tx: l.transactionHash,
			txUrl: config.txUrl(l.transactionHash),
			order: l.blockNumber * 100_000 + l.logIndex
		});
	}
	opts.logger?.info(`${c.chain} ${c.contract.slice(0, 10)}: ${counts.add} add, ${counts.remove} remove events${dropped ? ` (${dropped} dropped: contract/topic mismatch)` : ''}`);
	return { events: out, dropped };
}

/** TronGrid contract events, oldest first (fingerprint pagination, time-window fallback). */
export async function tronEvents(
	contract: string,
	eventName: string,
	opts: HttpOptions & { logger?: Logger; maxPages?: number } = {}
): Promise<{ events: Array<{ user: string; time: number; tx: string; index: number; block: number }>; dropped: number }> {
	const out: Array<{ user: string; time: number; tx: string; index: number; block: number }> = [];
	const seen = new Set<string>();
	const limiter = limiterFor(TRONGRID);
	const maxPages = opts.maxPages ?? 1000;
	const wantContract = contract.toLowerCase();
	let minTs = 0;
	let fingerprint: string | undefined;
	let dropped = 0;
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
			added++;
			// TronGrid is untrusted: never accept an event for a different
			// contract or event name than what was requested, however it
			// slipped in.
			const evName = String(ev.event_name ?? '');
			const evContract = String(ev.contract_address ?? '').toLowerCase();
			if (evName !== eventName || evContract !== wantContract) {
				dropped++;
				continue;
			}
			out.push({ user, time: Math.floor(time / 1000), tx, index, block: Number(ev.block_number ?? 0) });
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
	opts.logger?.info(`TRON ${contract.slice(0, 8)} ${eventName}: ${out.length} events${dropped ? ` (${dropped} dropped: contract/event mismatch)` : ''}`);
	return { events: out, dropped };
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

/**
 * Further deployments of the same oracle (code checked with eth_getCode and
 * events on Blockscout/Routescan, 2026-09-27). Base uses its own address.
 * BNB Chain, Fantom, Celo and Blast deployments exist but have no key-free
 * full-history log API that answers, so they are not read.
 */
export const ORACLE_OTHER_DEPLOYMENTS: Array<{ chain: keyof typeof LOG_APIS; contract: string; fromBlock?: number }> = [
	{ chain: 'ARB', contract: CHAINALYSIS_ORACLE },
	{ chain: 'OP', contract: CHAINALYSIS_ORACLE },
	{ chain: 'POL', contract: CHAINALYSIS_ORACLE },
	{ chain: 'AVAX', contract: CHAINALYSIS_ORACLE },
	// deployed in block 12,473,449 (first block with code, eth_getCode 2026-10-07)
	{ chain: 'BASE', contract: '0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B', fromBlock: 12_473_449 }
];

export const USDT0_SPEC: EventSourceSpec = {
	source: 'tether_usdt0',
	code: 'USDT0_FROZEN',
	category: 'stablecoin_freeze',
	risk: 'high',
	entity: 'Tether USDT0 (omnichain USDT)',
	text: (chain) => `USDT (USDT0) frozen on ${chain} (address blocked on the token contract)`,
	removedText: (chain) => `Formerly frozen (USDT0) on ${chain} — released`,
	refUrl: 'https://usdt0.to/'
};

export const CIRCLE_OTHER_SPEC: EventSourceSpec = { ...CIRCLE_SPEC, source: 'circle_other_chains' };

export const ORACLE_OTHER_SPEC: EventSourceSpec = {
	...ORACLE_SPEC,
	source: 'chainalysis_oracle_other_chains',
	text: (chains) => `Sanctioned per the Chainalysis on-chain sanctions oracle on ${chains} (mirror of OFAC SDN EVM addresses)`,
	removedText: (chain) => `Formerly sanctioned per the Chainalysis oracle on ${chain} — removed (delisted)`
};

const dropNote = (dropped: number): string[] =>
	dropped ? [`${dropped} upstream log(s)/event(s) dropped: emitting contract, topic0 or event name did not match what was requested`] : [];

export async function syncTether(opts: EventSyncOptions = {}): Promise<ParseResult> {
	const events: FreezeEvent[] = [];
	let dropped = 0;
	for (const c of TETHER_EVM) {
		const r = await evmFreezeEvents(c, opts, TETHER_SPEC.source);
		events.push(...r.events);
		dropped += r.dropped;
	}
	for (const [kind, name] of [
		['add', 'AddedBlackList'],
		['remove', 'RemovedBlackList']
	] as const) {
		const r = await tronEvents(TETHER_TRON_CONTRACT, name, opts);
		dropped += r.dropped;
		for (const e of r.events) {
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
	res.notes.push(...dropNote(dropped));
	return res;
}

export async function syncCircle(opts: EventSyncOptions = {}): Promise<ParseResult> {
	const events: FreezeEvent[] = [];
	let dropped = 0;
	for (const c of CIRCLE_EVM) {
		const r = await evmFreezeEvents(c, opts, CIRCLE_SPEC.source);
		events.push(...r.events);
		dropped += r.dropped;
	}
	const res = emptyResult();
	res.entries = foldEvents(events, CIRCLE_SPEC);
	res.version = `events:${events.length}`;
	res.notes.push(...dropNote(dropped));
	return res;
}

async function oracleEvents(
	chain: keyof typeof LOG_APIS,
	contract: string,
	opts: EventSyncOptions,
	source: string,
	fromBlock?: number
): Promise<{ events: FreezeEvent[]; dropped: number }> {
	const config = chainLogConfig(chain, opts.env);
	const seed = entriesSeed(opts, source, config, contract, (kind, address) => ({
		topics: [kind === 'add' ? TOPICS.SanctionedAddressesAdded : TOPICS.SanctionedAddressesRemoved],
		// an address[] of one: offset, length, the address
		data: '0x' + (32).toString(16).padStart(64, '0') + (1).toString(16).padStart(64, '0') + word(address).slice(2)
	}));
	const { logs, dropped } = await readContractLogs(
		{ config, contract, topics: [TOPICS.SanctionedAddressesAdded, TOPICS.SanctionedAddressesRemoved], fromBlock, seed },
		opts
	);
	const events: FreezeEvent[] = [];
	const counts = { add: 0, remove: 0 };
	for (const l of logs) {
		const kind = (l.topics[0] ?? '').toLowerCase() === TOPICS.SanctionedAddressesAdded ? 'add' : 'remove';
		counts[kind]++;
		decodeAddressArray(l.data).forEach((address, i) =>
			events.push({
				kind,
				address,
				chain,
				time: l.timeStamp,
				tx: l.transactionHash,
				txUrl: config.txUrl(l.transactionHash),
				order: l.blockNumber * 100_000 + l.logIndex * 1000 + i
			})
		);
	}
	opts.logger?.info(`${chain} oracle: ${counts.add} add, ${counts.remove} remove events`);
	return { events, dropped };
}

export async function syncChainalysisOracle(opts: EventSyncOptions = {}): Promise<ParseResult> {
	const { events, dropped } = await oracleEvents('ETH', CHAINALYSIS_ORACLE, opts, ORACLE_SPEC.source);
	const res = emptyResult();
	res.entries = foldEvents(events, ORACLE_SPEC);
	res.version = `events:${events.length}`;
	res.notes.push(...dropNote(dropped));
	return res;
}

/** The oracle's other deployments (every one must answer: a partial read would delist). */
export async function syncOracleOtherChains(opts: EventSyncOptions = {}): Promise<ParseResult> {
	const events: FreezeEvent[] = [];
	let dropped = 0;
	for (const d of ORACLE_OTHER_DEPLOYMENTS) {
		const r = await oracleEvents(d.chain, d.contract, opts, ORACLE_OTHER_SPEC.source, d.fromBlock);
		events.push(...r.events);
		dropped += r.dropped;
	}
	const res = emptyResult();
	res.entries = foldEvents(events, ORACLE_OTHER_SPEC);
	res.version = `events:${events.length}`;
	res.notes.push(...dropNote(dropped));
	return res;
}

async function syncEvmFreezes(contracts: EvmFreezeContract[], spec: EventSourceSpec, opts: EventSyncOptions): Promise<ParseResult> {
	const events: FreezeEvent[] = [];
	let dropped = 0;
	for (const c of contracts) {
		const r = await evmFreezeEvents(c, opts, spec.source);
		events.push(...r.events);
		dropped += r.dropped;
	}
	const res = emptyResult();
	res.entries = foldEvents(events, spec);
	res.version = `events:${events.length}`;
	res.notes.push(...dropNote(dropped));
	return res;
}

export const syncCircleOtherChains = (opts: EventSyncOptions = {}) => syncEvmFreezes(CIRCLE_OTHER_EVM, CIRCLE_OTHER_SPEC, opts);
export const syncUsdt0 = (opts: EventSyncOptions = {}) => syncEvmFreezes(USDT0_EVM, USDT0_SPEC, opts);
