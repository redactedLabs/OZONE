/**
 * Hack-cluster expansion on an EVM chain.
 *
 * Law-enforcement lists, victims and investigators name the first addresses
 * of a heist, but the THORChain swaps are usually made from the next layer
 * of fresh addresses the launderers fan the funds out to. This follows plain
 * native-coin transfers out of the seeds, level by level, strictly inside
 * the incident's laundering window and above a value threshold, and stops at:
 *
 * - services: an address with at least `serviceTxThreshold` outgoing
 *   transactions in the window (exchange hot wallets, THORChain vaults, …);
 * - contract calls (router deposits, DEX swaps, bridge deposits): they do
 *   not create a new holder;
 * - contracts: a recipient with code (bridges, routers, mixers, smart
 *   wallets) is never listed — checked in batches with eth_getCode; an
 *   EIP-7702 delegated EOA counts as an EOA; a recipient whose code could
 *   not be read is not listed either (counted);
 * - the request budget, a provider quota, the time budget or maxAddresses:
 *   the run is then cut short and returns the frontier it did not expand,
 *   so the next run resumes there (nothing is capped silently).
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import { emptyExpandResult, type ClusterMember, type ExpandResult, type FrontierNode, type ResumeState } from '../cluster/types.js';
import { QuotaExceeded } from '../explorers/budget.js';
import { evmBlockAt, evmContracts, evmTxList, LATEST_BLOCK, NoExplorer, type EvmChain, type ExplorerEnv } from '../explorers/evm.js';
import type { ClusterSpec } from '../sources/curated-data.js';
import type { Logger } from '../types.js';
import type { HttpOptions } from '../util/http.js';

export interface ExpandOptions {
	http?: HttpOptions;
	env?: ExplorerEnv;
	logger?: Logger;
	/** Explorer requests this run may spend (default: the spec's). */
	maxRequests?: number;
	/** Stop (resumably) after this time (ms since epoch). */
	deadline?: number;
	resume?: ResumeState;
	/** Addresses never followed or listed (current THORChain vaults and routers, known services). */
	exclude?: Set<string>;
	now?: number;
}

const blockCache = new Map<string, number>();

async function blockAt(chain: EvmChain, unix: number, closest: 'before' | 'after', o: ExpandOptions): Promise<{ block: number; requests: number }> {
	const id = `${chain}:${unix}:${closest}`;
	const hit = blockCache.get(id);
	if (hit !== undefined) return { block: hit, requests: 0 };
	const block = await evmBlockAt(chain, unix, closest, { http: o.http, env: o.env });
	blockCache.set(id, block);
	return { block, requests: 1 };
}

/** Wei per unit of the native coin as a bigint threshold (6 decimals of precision). */
function minWei(value: number): bigint {
	return BigInt(Math.round(value * 1e6)) * 10n ** 12n;
}

const isQuota = (e: unknown) => e instanceof QuotaExceeded || e instanceof NoExplorer;

export async function expandEvm(spec: ClusterSpec, seeds: string[], o: ExpandOptions = {}): Promise<ExpandResult> {
	const chain = spec.chain as EvmChain;
	const res = emptyExpandResult();
	const maxRequests = o.maxRequests ?? spec.maxRequests;
	const deadline = o.deadline ?? Infinity;
	const nowUnix = Math.floor((o.now ?? Date.now()) / 1000);
	const seedSet = new Set(seeds.map((s) => s.toLowerCase()));
	const known = new Set((o.resume?.known ?? []).map((a) => a.toLowerCase()));
	const exclude = o.exclude ?? new Set<string>();
	let frontier: FrontierNode[] = (o.resume?.frontier ?? [...seedSet].map((address) => ({ address, depth: 0 }))).map((n) => ({ address: n.address.toLowerCase(), depth: n.depth }));
	const cut = (stop: NonNullable<ExpandResult['stop']>, left: FrontierNode[], error?: string) => {
		res.truncated = true;
		res.stop = stop;
		res.frontier = left.filter((n) => n.depth < spec.maxDepth);
		if (error) res.error = error;
		return res;
	};

	// the window as blocks (an open window reads to the chain head)
	const from = Math.floor(Date.parse(spec.window.from) / 1000);
	const to = Math.min(Math.floor(Date.parse(spec.window.to) / 1000), nowUnix);
	let startblock: number;
	let endblock: number;
	try {
		const s = await blockAt(chain, from, 'after', o);
		startblock = s.block;
		res.requests += s.requests;
		if (to >= nowUnix - 300) endblock = LATEST_BLOCK;
		else {
			const e = await blockAt(chain, to, 'before', o);
			endblock = e.block;
			res.requests += e.requests;
		}
	} catch (e) {
		return cut(isQuota(e) ? 'noProvider' : 'error', frontier, (e as Error).message);
	}

	const threshold = minWei(spec.minValue);
	const pages = Math.max(1, Math.ceil(spec.serviceTxThreshold / 1000));
	for (let depth = Math.min(...frontier.map((n) => n.depth), spec.maxDepth); depth < spec.maxDepth && frontier.length; depth++) {
		const level = frontier.filter((n) => n.depth === depth);
		const later = frontier.filter((n) => n.depth !== depth);
		const candidates = new Map<string, { from: string; depth: number; value: bigint; tx: string; time: number }>();
		let stopped: { stop: NonNullable<ExpandResult['stop']>; left: FrontierNode[]; error?: string } | undefined;
		for (let i = 0; i < level.length; i++) {
			const node = level[i];
			if (res.requests >= maxRequests) stopped = { stop: 'budget', left: level.slice(i) };
			else if (Date.now() > deadline) stopped = { stop: 'time', left: level.slice(i) };
			else if (res.members.size + known.size >= spec.maxAddresses) stopped = { stop: 'maxAddresses', left: level.slice(i) };
			if (stopped) break;
			let list: Awaited<ReturnType<typeof evmTxList>>;
			try {
				list = await evmTxList(chain, node.address, { startblock, endblock, direction: 'from', sort: 'asc', maxPages: pages, http: o.http, env: o.env });
			} catch (e) {
				stopped = { stop: isQuota(e) ? 'quota' : 'error', left: level.slice(i), error: (e as Error).message };
				break;
			}
			res.requests += list.requests;
			if (list.more || list.txs.length >= spec.serviceTxThreshold) {
				res.services.add(node.address);
				if (list.more) res.skipped.longHistories++;
				if (node.depth > 0) res.members.delete(`evm:${node.address}`);
				continue;
			}
			for (const t of list.txs) {
				if (t.isError === '1') continue;
				if (t.input && t.input !== '0x') continue; // a contract call, not a new holder
				const toAddr = (t.to ?? '').toLowerCase();
				if (!/^0x[0-9a-f]{40}$/.test(toAddr)) continue;
				if (seedSet.has(toAddr) || known.has(toAddr) || exclude.has(toAddr) || res.services.has(toAddr) || res.contracts.has(toAddr)) continue;
				if (res.members.has(`evm:${toAddr}`) || candidates.has(toAddr)) continue;
				let value: bigint;
				try {
					value = BigInt(t.value);
				} catch {
					continue;
				}
				if (value < threshold) continue;
				candidates.set(toAddr, { from: node.address, depth: node.depth + 1, value, tx: t.hash, time: Number(t.timeStamp) });
			}
		}
		// contracts are never listed: one batched eth_getCode per level
		const codes = candidates.size ? await evmContracts(chain, [...candidates.keys()], { http: o.http }) : new Map<string, boolean>();
		const next: FrontierNode[] = [];
		for (const [address, c] of candidates) {
			const isContract = codes.get(address);
			if (isContract === undefined) {
				res.skipped.codeUnknown++;
				continue;
			}
			if (isContract) {
				res.contracts.add(address);
				continue;
			}
			const p = parseForChain(address, chain);
			if (!p) continue;
			const member: ClusterMember = {
				address,
				key: p.key,
				chain,
				depth: c.depth,
				from: c.from,
				value: Number(c.value / 10n ** 12n) / 1e6,
				tx: c.tx,
				time: c.time
			};
			res.members.set(p.key, member);
			next.push({ address, depth: c.depth });
		}
		o.logger?.info(`cluster ${spec.id}: depth ${depth + 1}: ${next.length} new addresses (total ${res.members.size}, ${res.requests} requests)`);
		frontier = [...later, ...next];
		if (stopped) return cut(stopped.stop, [...stopped.left, ...frontier], stopped.error);
	}
	return res;
}
