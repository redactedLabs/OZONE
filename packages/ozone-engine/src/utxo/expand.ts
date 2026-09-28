/**
 * Hack-cluster expansion on Bitcoin and Litecoin (Esplora, keyless).
 *
 * From each seed, the transactions it spends from inside the laundering
 * window are followed to their outputs: every output of at least
 * `minValue` that does not go back to one of the transaction's own inputs
 * (change) becomes a member one hop further. It stops at:
 *
 * - services: an address with at least `serviceTxThreshold` transactions;
 * - CoinJoin-like transactions (many inputs, several equal outputs): the
 *   outputs belong to other participants;
 * - cross-chain deposits: a transaction with a THORChain/Maya memo pays a
 *   vault — the depositor itself is already a member and its swap is traced
 *   through Midgard;
 * - the request budget, host quotas, the time budget or maxAddresses
 *   (resumable, as on EVM chains).
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import { emptyExpandResult, type ClusterMember, type ExpandResult, type FrontierNode } from '../cluster/types.js';
import { QuotaExceeded } from '../explorers/budget.js';
import { Esplora, isCoinJoin, isDepositMemo, opReturnText, type UtxoChain } from '../explorers/esplora.js';
import type { ExpandOptions } from '../evm/expand.js';
import type { ClusterSpec } from '../sources/curated-data.js';

export async function expandUtxo(spec: ClusterSpec, seeds: string[], o: ExpandOptions & { esplora?: Esplora } = {}): Promise<ExpandResult> {
	const chain = spec.chain as UtxoChain;
	const esplora = o.esplora ?? new Esplora(chain, { http: o.http });
	const res = emptyExpandResult();
	const maxRequests = o.maxRequests ?? spec.maxRequests;
	const deadline = o.deadline ?? Infinity;
	const nowUnix = Math.floor((o.now ?? Date.now()) / 1000);
	const canon = (a: string) => parseForChain(a, chain)?.address;
	const seedSet = new Set(seeds.map((s) => canon(s)).filter((s): s is string => !!s));
	const known = new Set((o.resume?.known ?? []).map((a) => canon(a) ?? a));
	const exclude = o.exclude ?? new Set<string>();
	let frontier: FrontierNode[] = o.resume?.frontier ?? [...seedSet].map((address) => ({ address, depth: 0 }));
	const from = Math.floor(Date.parse(spec.window.from) / 1000);
	const to = Math.min(Math.floor(Date.parse(spec.window.to) / 1000), nowUnix);
	const minSats = Math.round(spec.minValue * 1e8);
	const startRequests = esplora.requests;
	const spent = () => esplora.requests - startRequests;
	const cut = (stop: NonNullable<ExpandResult['stop']>, left: FrontierNode[], error?: string) => {
		res.truncated = true;
		res.stop = stop;
		res.frontier = left.filter((n) => n.depth < spec.maxDepth);
		if (error) res.error = error;
		res.requests = spent();
		return res;
	};

	for (let depth = Math.min(...frontier.map((n) => n.depth), spec.maxDepth); depth < spec.maxDepth && frontier.length; depth++) {
		const level = frontier.filter((n) => n.depth === depth);
		const later = frontier.filter((n) => n.depth !== depth);
		const next: FrontierNode[] = [];
		let stopped: { stop: NonNullable<ExpandResult['stop']>; left: FrontierNode[]; error?: string } | undefined;
		for (let i = 0; i < level.length; i++) {
			const node = level[i];
			if (spent() >= maxRequests) stopped = { stop: 'budget', left: level.slice(i) };
			else if (Date.now() > deadline) stopped = { stop: 'time', left: level.slice(i) };
			else if (res.members.size + known.size >= spec.maxAddresses) stopped = { stop: 'maxAddresses', left: level.slice(i) };
			if (stopped) break;
			try {
				const stats = await esplora.address(node.address);
				const txCount = stats.chain_stats?.tx_count ?? 0;
				if (txCount >= spec.serviceTxThreshold) {
					res.services.add(node.address);
					if (node.depth > 0) res.members.delete(`${parseForChain(node.address, chain)?.key}`);
					continue;
				}
				const maxPages = Math.max(1, Math.ceil(txCount / 25) + 1);
				const { txs, more } = await esplora.txsInWindow(node.address, from, to, maxPages);
				if (more) res.skipped.longHistories++;
				for (const tx of txs) {
					const inputs = new Set(tx.vin.map((v) => (v.prevout?.scriptpubkey_address ? canon(v.prevout.scriptpubkey_address) : undefined)).filter((a): a is string => !!a));
					if (!inputs.has(node.address)) continue; // received, not spent
					if (isCoinJoin(tx)) {
						res.skipped.coinjoins++;
						continue;
					}
					if (isDepositMemo(opReturnText(tx))) {
						res.skipped.deposits++;
						continue;
					}
					for (const out of tx.vout) {
						const addr = out.scriptpubkey_address ? canon(out.scriptpubkey_address) : undefined;
						if (!addr || inputs.has(addr) || out.value < minSats) continue;
						if (seedSet.has(addr) || known.has(addr) || exclude.has(addr) || res.services.has(addr)) continue;
						const p = parseForChain(addr, chain);
						if (!p || res.members.has(p.key)) continue;
						const member: ClusterMember = {
							address: p.address,
							key: p.key,
							chain,
							depth: node.depth + 1,
							from: node.address,
							value: out.value / 1e8,
							tx: tx.txid,
							time: tx.status?.block_time ?? 0
						};
						res.members.set(p.key, member);
						next.push({ address: p.address, depth: node.depth + 1 });
					}
				}
			} catch (e) {
				stopped = { stop: e instanceof QuotaExceeded ? 'quota' : 'error', left: level.slice(i), error: (e as Error).message };
				break;
			}
		}
		o.logger?.info(`cluster ${spec.id}: depth ${depth + 1}: ${next.length} new addresses (total ${res.members.size}, ${spent()} requests)`);
		frontier = [...later, ...next];
		if (stopped) return cut(stopped.stop, [...stopped.left, ...frontier], stopped.error);
	}
	res.requests = spent();
	return res;
}
