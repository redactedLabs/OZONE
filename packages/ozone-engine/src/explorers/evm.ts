/**
 * Etherscan-compatible explorer APIs for the EVM chains Ozone expands and
 * looks back on, tried in order until one answers:
 *
 * 1. Etherscan API v2 with the owner's `ETHERSCAN_API_KEY` (free: 5 calls/s,
 *    100,000 a day; since 2025 the free tier excludes Avalanche, Base, BNB
 *    Chain and OP — set `ETHERSCAN_PAID=1` for a plan that includes them);
 * 2. the Blockscout PRO API with `BLOCKSCOUT_API_KEY` (free: 5 calls/s,
 *    about 5,000 calls a day);
 * 3. routescan, keyless (2 calls/s, 10,000 a day; Ethereum and Avalanche);
 * 4. the chain's own Blockscout instance, keyless — measured 2026-09-28 at
 *    10 requests per IP and hour, so it only serves a trickle.
 *
 * Keys are read from the environment only when set; nothing is sent to a
 * host that does not need it. Contract detection uses a public JSON-RPC
 * endpoint (eth_getCode, batched).
 */
import { httpJson, HttpError, type HttpOptions } from '../util/http.js';
import { hostBudget, QuotaExceeded, type HostBudget } from './budget.js';

export type EvmChain = 'ETH' | 'ARB' | 'OP' | 'BASE' | 'POL' | 'AVAX' | 'BSC' | 'GNOSIS';

export const EVM_CHAINS: readonly EvmChain[] = ['ETH', 'ARB', 'OP', 'BASE', 'POL', 'AVAX', 'BSC', 'GNOSIS'];

export const EVM_CHAIN_IDS: Record<EvmChain, number> = { ETH: 1, OP: 10, BSC: 56, GNOSIS: 100, POL: 137, BASE: 8453, ARB: 42161, AVAX: 43114 };

/** `endblock` for "up to the chain head" (above any chain's block height for decades). */
export const LATEST_BLOCK = 9_999_999_999;

export function isEvmChain(chain: string): chain is EvmChain {
	return (EVM_CHAINS as readonly string[]).includes(chain);
}

const BLOCKSCOUT_INSTANCES: Partial<Record<EvmChain, string>> = {
	ETH: 'https://eth.blockscout.com/api',
	ARB: 'https://arbitrum.blockscout.com/api',
	OP: 'https://optimism.blockscout.com/api',
	BASE: 'https://base.blockscout.com/api',
	POL: 'https://polygon.blockscout.com/api',
	GNOSIS: 'https://gnosis.blockscout.com/api'
};

const ROUTESCAN: Partial<Record<EvmChain, string>> = {
	ETH: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
	AVAX: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api'
};

/** Chains the free Etherscan API tier still covers (the rest need a paid plan). */
const ETHERSCAN_FREE: readonly EvmChain[] = ['ETH', 'ARB', 'POL', 'GNOSIS'];

/** Public JSON-RPC endpoints (PublicNode) for eth_getCode. */
export const PUBLIC_RPC: Record<EvmChain, string> = {
	ETH: 'https://ethereum-rpc.publicnode.com',
	ARB: 'https://arbitrum-one-rpc.publicnode.com',
	OP: 'https://optimism-rpc.publicnode.com',
	BASE: 'https://base-rpc.publicnode.com',
	POL: 'https://polygon-bor-rpc.publicnode.com',
	AVAX: 'https://avalanche-c-chain-rpc.publicnode.com',
	BSC: 'https://bsc-rpc.publicnode.com',
	GNOSIS: 'https://gnosis-rpc.publicnode.com'
};

const DAY = 24 * 3600_000;
const HOUR = 3600_000;

export interface ExplorerEnv {
	ETHERSCAN_API_KEY?: string;
	ETHERSCAN_PAID?: string;
	BLOCKSCOUT_API_KEY?: string;
}

export interface EvmProvider {
	name: 'etherscan' | 'blockscout-pro' | 'routescan' | 'blockscout';
	chain: EvmChain;
	url: string;
	/** Extra query parameters (chain id, key). */
	params: Record<string, string>;
	/** Supports Blockscout's `filter_by=from|to`. */
	filterBy: boolean;
	budget: HostBudget;
}

/** The providers for a chain, best first (see the module comment). */
export function evmProviders(chain: EvmChain, env: ExplorerEnv = process.env): EvmProvider[] {
	const out: EvmProvider[] = [];
	const id = String(EVM_CHAIN_IDS[chain]);
	if (env.ETHERSCAN_API_KEY && (env.ETHERSCAN_PAID === '1' || ETHERSCAN_FREE.includes(chain))) {
		out.push({
			name: 'etherscan',
			chain,
			url: 'https://api.etherscan.io/v2/api',
			params: { chainid: id, apikey: env.ETHERSCAN_API_KEY },
			filterBy: false,
			budget: hostBudget('api.etherscan.io', { minIntervalMs: 250, perWindow: 90_000, windowMs: DAY })
		});
	}
	if (env.BLOCKSCOUT_API_KEY) {
		out.push({
			name: 'blockscout-pro',
			chain,
			url: 'https://api.blockscout.com/v2/api',
			params: { chain_id: id, apikey: env.BLOCKSCOUT_API_KEY },
			filterBy: true,
			budget: hostBudget('api.blockscout.com', { minIntervalMs: 250, perWindow: 4_500, windowMs: DAY })
		});
	}
	const rs = ROUTESCAN[chain];
	if (rs) {
		out.push({
			name: 'routescan',
			chain,
			url: rs,
			params: {},
			filterBy: false,
			budget: hostBudget('api.routescan.io', { minIntervalMs: 600, perWindow: 9_000, windowMs: DAY })
		});
	}
	const bs = BLOCKSCOUT_INSTANCES[chain];
	if (bs) {
		out.push({
			name: 'blockscout',
			chain,
			url: bs,
			params: {},
			filterBy: true,
			budget: hostBudget(new URL(bs).host, { minIntervalMs: 1_000, perWindow: 8, windowMs: HOUR })
		});
	}
	return out;
}

/** Requests the providers of a chain can still send now (Infinity when unlimited). */
export function evmCapacity(chain: EvmChain, env: ExplorerEnv = process.env): number {
	return evmProviders(chain, env).reduce((n, p) => n + p.budget.remaining(), 0);
}

export class NoExplorer extends Error {
	constructor(readonly chain: string) {
		super(`no explorer API available for ${chain} (all quotas spent or none configured)`);
		this.name = 'NoExplorer';
	}
}

interface EtherscanBody {
	status?: string;
	message?: string;
	result?: unknown;
}

const RATE_LIMITED = /rate limit|too many|max calls|limit reached|quota/i;
const NOT_SUPPORTED = /chain not supported|not supported|invalid api key|missing\/invalid api key|api key.*(invalid|required)|free api access/i;

/**
 * One Etherscan-compatible call on the first provider that can take it. A
 * provider that is rate limiting (429 or a "rate limit" answer) is blocked
 * for an hour and the next one is tried; a provider that does not serve
 * the chain is skipped. Throws NoExplorer when none could answer.
 */
export async function evmCall<T = unknown>(
	chain: EvmChain,
	params: Record<string, string | number>,
	opts: { http?: HttpOptions; env?: ExplorerEnv } = {}
): Promise<{ result: T; provider: EvmProvider['name'] }> {
	let lastError: unknown;
	for (const p of evmProviders(chain, opts.env)) {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (k === 'filter_by' && !p.filterBy) continue;
			q.set(k, String(v));
		}
		for (const [k, v] of Object.entries(p.params)) q.set(k, v);
		const url = `${p.url}?${q.toString()}`;
		try {
			const body = await p.budget.run(() => httpJson<EtherscanBody>(url, { timeoutMs: 60_000, retries: 1, ...opts.http }));
			const msg = `${String(body.message ?? '')} ${typeof body.result === 'string' ? body.result : ''}`;
			if (body.status === '0' && RATE_LIMITED.test(msg)) {
				p.budget.block(Date.now() + HOUR);
				lastError = new Error(`${p.name}: ${msg.trim()}`);
				continue;
			}
			if (body.status === '0' && NOT_SUPPORTED.test(msg)) {
				lastError = new Error(`${p.name}: ${msg.trim()}`);
				continue;
			}
			// "No transactions found" and friends: an empty answer, not an error
			if (body.status === '0' && !Array.isArray(body.result) && /no .*found/i.test(msg)) return { result: [] as T, provider: p.name };
			if (body.status === '0' && !Array.isArray(body.result) && typeof body.result !== 'object') {
				lastError = new Error(`${p.name}: ${msg.trim() || 'NOTOK'}`);
				continue;
			}
			return { result: body.result as T, provider: p.name };
		} catch (e) {
			lastError = e;
			if (e instanceof QuotaExceeded) continue;
			if (e instanceof HttpError && e.status === 429) p.budget.block(Date.now() + HOUR);
		}
	}
	throw lastError instanceof QuotaExceeded || !lastError ? new NoExplorer(chain) : Object.assign(new NoExplorer(chain), { cause: lastError });
}

/** Block at (or before/after) a unix time. */
export async function evmBlockAt(chain: EvmChain, unix: number, closest: 'before' | 'after', opts: { http?: HttpOptions; env?: ExplorerEnv } = {}): Promise<number> {
	const { result } = await evmCall<{ blockNumber?: string } | string>(chain, { module: 'block', action: 'getblocknobytime', timestamp: unix, closest }, opts);
	const n = Number(typeof result === 'object' && result !== null ? result.blockNumber : result);
	if (!Number.isFinite(n) || n <= 0) throw new Error(`${chain}: getblocknobytime failed`);
	return n;
}

/** A normal (external) transaction as the Etherscan-compatible APIs return it. */
export interface EvmTx {
	blockNumber: string;
	timeStamp: string;
	hash: string;
	from: string;
	to: string;
	value: string;
	input: string;
	isError: string;
}

/**
 * Normal transactions of `address` between two blocks, `direction` from it,
 * to it or both, `sort`ed, up to `maxPages` pages of 1,000. `more` tells
 * whether the page limit cut the list.
 */
export async function evmTxList(
	chain: EvmChain,
	address: string,
	o: { startblock: number; endblock: number; direction: 'from' | 'to' | 'any'; sort?: 'asc' | 'desc'; maxPages?: number; pageSize?: number; http?: HttpOptions; env?: ExplorerEnv }
): Promise<{ txs: EvmTx[]; requests: number; more: boolean }> {
	const a = address.toLowerCase();
	const out: EvmTx[] = [];
	const pageSize = o.pageSize ?? 1000;
	let requests = 0;
	for (let page = 1; page <= (o.maxPages ?? 5); page++) {
		const { result } = await evmCall<EvmTx[]>(
			chain,
			{
				module: 'account',
				action: 'txlist',
				address: a,
				...(o.direction !== 'any' ? { filter_by: o.direction } : {}),
				startblock: o.startblock,
				endblock: o.endblock,
				sort: o.sort ?? 'asc',
				page,
				offset: pageSize
			},
			{ http: o.http, env: o.env }
		);
		requests++;
		const list = Array.isArray(result) ? result : [];
		for (const t of list) {
			const from = (t.from ?? '').toLowerCase();
			const to = (t.to ?? '').toLowerCase();
			if (o.direction === 'from' && from !== a) continue;
			if (o.direction === 'to' && to !== a) continue;
			out.push(t);
		}
		if (list.length < pageSize) return { txs: out, requests, more: false };
	}
	return { txs: out, requests, more: true };
}

/** EIP-7702: an EOA with a delegation designator is still an EOA. */
const DELEGATED_EOA = /^0xef0100[0-9a-f]{40}$/i;

/**
 * Which of `addresses` are contracts (eth_getCode on a public RPC, batched).
 * An address whose code could not be read is absent from the result.
 */
export async function evmContracts(
	chain: EvmChain,
	addresses: string[],
	opts: { http?: HttpOptions; batch?: number } = {}
): Promise<Map<string, boolean>> {
	const out = new Map<string, boolean>();
	const rpc = PUBLIC_RPC[chain];
	const budget = hostBudget(new URL(rpc).host, { minIntervalMs: 400 });
	const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
	const size = opts.batch ?? 40;
	for (let i = 0; i < unique.length; i += size) {
		const chunk = unique.slice(i, i + size);
		const body = JSON.stringify(chunk.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getCode', params: [a, 'latest'] })));
		try {
			const res = await budget.run(() =>
				httpJson<Array<{ id: number; result?: string }>>(rpc, {
					method: 'POST',
					body,
					headers: { 'content-type': 'application/json' },
					timeoutMs: 30_000,
					retries: 2,
					...opts.http
				})
			);
			for (const r of Array.isArray(res) ? res : []) {
				const a = chunk[r.id];
				if (a === undefined || typeof r.result !== 'string') continue;
				const code = r.result.toLowerCase();
				out.set(a, code !== '0x' && code !== '' && !DELEGATED_EOA.test(code));
			}
		} catch {
			// unknown for this chunk: callers treat "unknown" as "not a proven EOA"
		}
	}
	return out;
}
