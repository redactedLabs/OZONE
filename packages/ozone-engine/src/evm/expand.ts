/**
 * Hack-cluster expansion on Ethereum.
 *
 * Law-enforcement and explorer labels name the first addresses of a heist
 * (e.g. the FBI's 51 Bybit addresses, Etherscan's "Bybit Exploiter N"), but
 * the THORChain swaps are usually made from the next layer of fresh
 * addresses the launderers fan the funds out to. This follows plain ETH
 * transfers out of the seeds, breadth-first, strictly inside the incident's
 * laundering window and above a value threshold, and stops at services
 * (addresses with large activity such as exchange hot wallets) and at
 * contract calls. The result is a set of cluster addresses with depth and
 * the funding transfer as provenance; they seed THORChain tracing.
 *
 * Data: Blockscout's public API (no key), rate-limited to ~1 request/s.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import type { ClusterSpec } from '../sources/curated-data.js';
import { emptyResult, type ListEntry, type Logger, type ParseResult } from '../types.js';
import { httpJson, RateLimiter, type HttpOptions } from '../util/http.js';

interface Provider {
	name: string;
	api: string;
	/** Supports `filter_by=from` (Blockscout); otherwise outgoing txs are filtered locally. */
	filterFrom: boolean;
	limiter: RateLimiter;
	failed?: boolean;
}

const PROVIDERS: Provider[] = [
	{ name: 'blockscout', api: 'https://eth.blockscout.com/api', filterFrom: true, limiter: new RateLimiter(1100, 1) },
	{ name: 'routescan', api: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api', filterFrom: false, limiter: new RateLimiter(1100, 1) }
];

export interface ClusterMember {
	address: string;
	depth: number;
	from: string;
	valueEth: number;
	tx: string;
	time: number;
}

export interface ExpandResult {
	members: Map<string, ClusterMember>;
	services: Set<string>;
	requests: number;
	truncated: boolean;
}

/**
 * One Etherscan-compatible call on the first provider that is not rate
 * limiting us; a provider that keeps answering 429 is skipped for the run.
 */
async function bs<T>(params: Record<string, string | number>, opts: HttpOptions): Promise<{ body: T; provider: Provider }> {
	for (const provider of PROVIDERS) {
		if (provider.failed) continue;
		const p = { ...params };
		if (!provider.filterFrom) delete p.filter_by;
		const q = new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]));
		const url = `${provider.api}?${q.toString()}`;
		try {
			for (let attempt = 0; attempt < 3; attempt++) {
				const body = await provider.limiter.run(() =>
					httpJson<{ status?: string; message?: string; result?: unknown }>(url, { timeoutMs: 90_000, retries: 2, ...opts })
				);
				const msg = String(body.message ?? '');
				if (body.status === '0' && /too many|rate limit/i.test(msg)) {
					await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
					continue;
				}
				return { body: body as T, provider };
			}
			throw new Error('rate limited');
		} catch (e) {
			provider.failed = true;
		}
	}
	throw new Error('no Ethereum explorer API available (all rate limited)');
}

export async function blockAt(time: number, opts: HttpOptions = {}): Promise<number> {
	const { body } = await bs<{ result?: { blockNumber?: string } | string }>(
		{ module: 'block', action: 'getblocknobytime', timestamp: time, closest: 'before' },
		opts
	);
	const n = Number(typeof body.result === 'object' ? body.result?.blockNumber : body.result);
	if (!Number.isFinite(n) || n <= 0) throw new Error('getblocknobytime failed');
	return n;
}

interface BsTx {
	blockNumber: string;
	timeStamp: string;
	hash: string;
	from: string;
	to: string;
	value: string;
	input: string;
	isError: string;
}

export async function expandCluster(
	spec: ClusterSpec,
	seeds: string[],
	opts: { http?: HttpOptions; logger?: Logger; maxRequests?: number } = {}
): Promise<ExpandResult> {
	const http = opts.http ?? {};
	const from = Math.floor(Date.parse(spec.window.from) / 1000);
	const to = Math.floor(Date.parse(spec.window.to) / 1000);
	const startblock = await blockAt(from, http);
	const endblock = await blockAt(to, http);
	const minWei = BigInt(Math.round(spec.minValueEth * 1e6)) * 10n ** 12n;
	const members = new Map<string, ClusterMember>();
	const services = new Set<string>();
	const seedSet = new Set(seeds.map((s) => s.toLowerCase()));
	let requests = 2;
	let truncated = false;
	let frontier = [...seedSet].map((a) => ({ address: a, depth: 0 }));
	const maxRequests = opts.maxRequests ?? 50_000;

	for (let depth = 0; depth < spec.maxDepth && frontier.length; depth++) {
		const next: Array<{ address: string; depth: number }> = [];
		for (const node of frontier) {
			if (requests >= maxRequests || members.size >= spec.maxAddresses) {
				truncated = true;
				break;
			}
			const txs: BsTx[] = [];
			for (let page = 1; page <= 5; page++) {
				const { body: r } = await bs<{ result?: BsTx[] }>(
					{
						module: 'account',
						action: 'txlist',
						address: node.address,
						filter_by: 'from',
						startblock,
						endblock,
						sort: 'asc',
						page,
						offset: 1000
					},
					http
				);
				requests++;
				const list = Array.isArray(r.result) ? r.result : [];
				txs.push(...list);
				if (list.length < 1000) break;
			}
			const outgoing = txs.filter((t) => t.from?.toLowerCase() === node.address);
			if (outgoing.length >= spec.serviceTxThreshold) {
				services.add(node.address);
				if (node.depth > 0) members.delete(node.address);
				continue;
			}
			for (const t of outgoing) {
				if (t.isError === '1') continue;
				if (t.input && t.input !== '0x') continue; // contract call (router deposit, DEX, …): not a new holder
				const toAddr = (t.to ?? '').toLowerCase();
				if (!/^0x[0-9a-f]{40}$/.test(toAddr) || seedSet.has(toAddr) || members.has(toAddr) || services.has(toAddr)) continue;
				let value: bigint;
				try {
					value = BigInt(t.value);
				} catch {
					continue;
				}
				if (value < minWei) continue;
				members.set(toAddr, {
					address: toAddr,
					depth: node.depth + 1,
					from: node.address,
					valueEth: Number(value / 10n ** 12n) / 1e6,
					tx: t.hash,
					time: Number(t.timeStamp)
				});
				next.push({ address: toAddr, depth: node.depth + 1 });
			}
		}
		opts.logger?.info(`cluster ${spec.id}: depth ${depth + 1}: ${next.length} new addresses (total ${members.size}, ${requests} requests)`);
		frontier = next;
		if (truncated) break;
	}
	return { members, services, requests, truncated };
}

/** Risk by depth: the first two layers are the launderer's own fan-out. */
export function clusterRisk(spec: ClusterSpec, depth: number): 'high' | 'medium' | 'low' {
	if (depth <= 2) return spec.risk === 'high' || spec.risk === 'severe' ? 'high' : 'medium';
	if (depth === 3) return 'medium';
	return 'low';
}

export function clusterEntries(spec: ClusterSpec, result: ExpandResult): ParseResult {
	const res = emptyResult();
	res.version = `${spec.id}:${result.members.size}`;
	for (const m of result.members.values()) {
		const p = parseForChain(m.address, 'ETH');
		if (!p) continue;
		const entry: ListEntry = {
			source: 'cluster',
			key: p.key,
			chain: 'ETH',
			address: p.address,
			category: 'hack',
			risk: clusterRisk(spec, m.depth),
			code: 'HACK_CLUSTER',
			entity: spec.entity,
			text: `${spec.name}: received ${m.valueEth} ETH from ${m.from} (${m.depth} hop${m.depth > 1 ? 's' : ''} from the attributed addresses) on ${new Date(m.time * 1000).toISOString().slice(0, 10)}`,
			refUrl: `https://etherscan.io/tx/${m.tx}`,
			refId: m.tx,
			listedAt: new Date(m.time * 1000).toISOString(),
			meta: { cluster: spec.id, depth: m.depth, from: m.from, valueEth: m.valueEth, sourceRef: spec.ref }
		};
		res.entries.push(entry);
	}
	if (result.truncated) res.notes.push(`${spec.id}: expansion truncated at ${result.members.size} addresses / ${result.requests} requests`);
	res.notes.push(`${spec.id}: ${result.services.size} service addresses excluded`);
	return res;
}
