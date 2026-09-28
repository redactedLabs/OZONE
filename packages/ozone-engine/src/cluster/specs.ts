/**
 * Which clusters to expand: one per incident and chain, seeded with the
 * incident's own attacker addresses on that chain, inside its laundering
 * window. Three origins:
 *
 * - every curated incident (sources/curated-data.ts), per chain it has
 *   exploiter or laundering addresses on (cash-out addresses are end
 *   points, not seeds);
 * - explicit specs in CURATED.clusters (e.g. Bybit, seeded from the FBI
 *   list and the eth-labels "Bybit Exploiter" labels);
 * - incidents a maintainer pasted through the incident path (manual flags
 *   with an incident name), from their flags' addresses; urgent while the
 *   flags are.
 */
import { createHash } from 'node:crypto';
import { parseListedAddress } from '../../../ozone-client/src/index.js';
import { isEvmChain } from '../explorers/evm.js';
import { isUtxoChain } from '../explorers/esplora.js';
import { CURATED, type ClusterSpec, type CuratedData, type ExpansionParams } from '../sources/curated-data.js';
import type { Sql } from '../types.js';

const DAY = 24 * 3600_000;

/** Days after the theft a curated incident's laundering is followed by default. */
export const DEFAULT_WINDOW_DAYS = 180;

/**
 * Per chain: smallest transfer followed (about $1,500–2,000 in the chain's
 * native unit), hops, and how much one run may spend.
 */
export const CHAIN_DEFAULTS: Record<string, ExpansionParams> = {
	ETH: { minValue: 0.5, maxDepth: 2, maxAddresses: 3000, maxRequests: 400, serviceTxThreshold: 500 },
	ARB: { minValue: 0.5, maxDepth: 2, maxAddresses: 1000, maxRequests: 150, serviceTxThreshold: 500 },
	OP: { minValue: 0.5, maxDepth: 2, maxAddresses: 1000, maxRequests: 150, serviceTxThreshold: 500 },
	BASE: { minValue: 0.5, maxDepth: 2, maxAddresses: 1000, maxRequests: 150, serviceTxThreshold: 500 },
	POL: { minValue: 5_000, maxDepth: 2, maxAddresses: 1000, maxRequests: 150, serviceTxThreshold: 500 },
	GNOSIS: { minValue: 2_000, maxDepth: 2, maxAddresses: 1000, maxRequests: 150, serviceTxThreshold: 500 },
	AVAX: { minValue: 60, maxDepth: 2, maxAddresses: 1000, maxRequests: 200, serviceTxThreshold: 500 },
	BSC: { minValue: 3, maxDepth: 2, maxAddresses: 1000, maxRequests: 200, serviceTxThreshold: 500 },
	BTC: { minValue: 0.02, maxDepth: 3, maxAddresses: 2000, maxRequests: 300, serviceTxThreshold: 300 },
	LTC: { minValue: 20, maxDepth: 3, maxAddresses: 1000, maxRequests: 150, serviceTxThreshold: 300 }
};

export function isExpandableChain(chain: string): boolean {
	return (isEvmChain(chain) || isUtxoChain(chain)) && !!CHAIN_DEFAULTS[chain];
}

/** Specs for every curated incident and every explicit cluster. */
export function curatedClusterSpecs(data: CuratedData = CURATED): ClusterSpec[] {
	const explicit = data.clusters.map((c) => ({ ...c }));
	const covered = new Set(explicit.map((c) => `${c.incident}|${c.chain}`));
	const out: ClusterSpec[] = [...explicit];
	for (const inc of data.incidents) {
		if (inc.expand === false) continue;
		const byChain = new Map<string, string[]>();
		for (const a of inc.addresses) {
			if (a.delisted || a.role === 'cashout') continue;
			const p = parseListedAddress(a.address, a.chain)?.parsed;
			if (!p) continue;
			// an EVM key is one holder on every EVM chain: expand on the chain the source names
			const chain = a.chain.toUpperCase();
			if (!isExpandableChain(chain)) continue;
			if (inc.expand?.chains && !inc.expand.chains.includes(chain)) continue;
			byChain.set(chain, [...(byChain.get(chain) ?? []), p.address]);
		}
		for (const [chain, seeds] of byChain) {
			const explicitSpec = explicit.find((c) => c.incident === inc.id && c.chain === chain);
			if (explicitSpec) {
				// an explicit spec for the same incident and chain also gets the incident's own addresses
				explicitSpec.seeds = [...new Set([...(explicitSpec.seeds ?? []), ...seeds])];
				continue;
			}
			if (covered.has(`${inc.id}|${chain}`)) continue;
			const from = inc.window?.from ?? `${inc.date}T00:00:00Z`;
			const to = inc.window?.to ?? new Date(Date.parse(from) + DEFAULT_WINDOW_DAYS * DAY).toISOString();
			out.push({
				...CHAIN_DEFAULTS[chain],
				...(inc.expand ? inc.expand.params : {}),
				id: `${inc.id}:${chain}`,
				incident: inc.id,
				name: inc.name,
				chain,
				entity: inc.name,
				ref: inc.ref,
				seeds: [...new Set(seeds)],
				window: { from, to },
				risk: 'high',
				priority: inc.thorchain.used === 'yes' ? 0 : 1
			});
		}
	}
	return out;
}

interface ManualRow {
	address: string;
	chain: string | null;
	added_at: string | Date;
	incident: string | null;
	ref_url: string | null;
	urgent_until: string | Date | null;
}

export const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48) || 'incident';

/**
 * Specs for incidents a maintainer pasted (active manual flags with an
 * incident name): window from a week before the first flag to now, open
 * for DEFAULT_WINDOW_DAYS.
 */
export async function manualClusterSpecs(sql: Sql, now = new Date()): Promise<ClusterSpec[]> {
	let rows: ManualRow[];
	try {
		rows = (
			await sql.query<ManualRow>(
				`SELECT f.address, f.chain, f.added_at, m.incident, m.ref_url, m.urgent_until
				 FROM manual_flags f JOIN oz_manual_meta m ON m.flag_id = f.id
				 WHERE f.active = true AND m.incident IS NOT NULL AND m.incident <> ''`
			)
		).rows;
	} catch {
		return []; // migration 0004 not applied yet
	}
	const groups = new Map<string, { incident: string; chain: string; seeds: Set<string>; first: number; urgent: boolean; ref?: string }>();
	for (const r of rows) {
		const parsed = parseListedAddress(r.address, r.chain)?.parsed;
		if (!parsed) continue;
		const chain = parsed.namespace === 'evm' ? (r.chain && isEvmChain(r.chain.toUpperCase()) ? r.chain.toUpperCase() : 'ETH') : parsed.chain;
		if (!isExpandableChain(chain)) continue;
		const id = `manual:${slug(r.incident!)}:${chain}`;
		const g = groups.get(id) ?? { incident: r.incident!, chain, seeds: new Set<string>(), first: Infinity, urgent: false };
		g.seeds.add(parsed.address);
		g.first = Math.min(g.first, new Date(r.added_at).getTime());
		if (r.urgent_until && new Date(r.urgent_until).getTime() > now.getTime()) g.urgent = true;
		if (!g.ref && r.ref_url && /^https?:\/\//.test(r.ref_url)) g.ref = r.ref_url;
		groups.set(id, g);
	}
	const out: ClusterSpec[] = [];
	for (const [id, g] of groups) {
		const from = new Date(g.first - 7 * DAY);
		const to = new Date(Math.min(now.getTime(), from.getTime() + DEFAULT_WINDOW_DAYS * DAY));
		out.push({
			...CHAIN_DEFAULTS[g.chain],
			id,
			incident: `manual:${slug(g.incident)}`,
			name: g.incident,
			chain: g.chain,
			entity: g.incident,
			ref: g.ref ?? 'https://ozone.redacted.gg/methodology#manual',
			seeds: [...g.seeds],
			window: { from: from.toISOString(), to: to.toISOString() },
			risk: 'high',
			urgent: g.urgent,
			priority: g.urgent ? -1 : 0
		});
	}
	return out;
}

/**
 * Fingerprint of what a full run depends on: chain, window start and
 * parameters (not the seeds — added seeds are expanded incrementally — and
 * not the end of an open window, which moves with time). A changed
 * fingerprint means a full re-run.
 */
export function specHash(spec: ClusterSpec): string {
	const basis = { chain: spec.chain, from: spec.window.from, p: [spec.minValue, spec.maxDepth, spec.maxAddresses, spec.serviceTxThreshold] };
	return createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 16);
}

export interface ClusterRunRow {
	cluster: string;
	ran_at: string | Date;
	complete: boolean;
	params_hash: string;
	window_to: string | Date | null;
	seeds: string[] | null;
	/** Addresses the cluster's runs found to be services: never followed or listed again. */
	service_list?: string[] | null;
	frontier: Array<{ address: string; depth: number }> | null;
}

export type RunPlan =
	| { mode: 'skip'; why: string }
	/** Members from before pass E (seeded by migration 0005) are taken over as the result of a complete run. */
	| { mode: 'adopt' }
	| { mode: 'full' }
	/** Continue a run that was cut short. */
	| { mode: 'resume'; frontier: Array<{ address: string; depth: number }> }
	/** Expand only seeds added since the last complete run. */
	| { mode: 'incremental'; frontier: Array<{ address: string; depth: number }> };

/**
 * What a cluster needs now:
 * - never ran: adopt the members it already has (pre-pass-E results), else a full run;
 * - parameters changed, or seeds were removed: a full run;
 * - its last run was cut short (budget, quota, time): resume from its frontier;
 * - seeds were added: expand just those;
 * - its window was still open at the last run and `periodMs` has passed: a full run;
 * - otherwise nothing: a complete run of a closed window is final.
 */
export function planRun(spec: ClusterSpec, seeds: string[], last: ClusterRunRow | undefined, hasMembers: boolean, now: number, periodMs: number): RunPlan {
	const hash = specHash(spec);
	const norm = (a: string[]) => [...new Set(a.map((x) => x.toLowerCase()))];
	const current = norm(seeds);
	if (!last) return hasMembers ? { mode: 'adopt' } : { mode: 'full' };
	if (last.params_hash !== hash) return { mode: 'full' };
	const before = new Set(norm(last.seeds ?? []));
	const removed = [...before].some((s) => !current.includes(s));
	if (removed) return { mode: 'full' };
	if (!last.complete) {
		const frontier = last.frontier ?? [];
		return frontier.length ? { mode: 'resume', frontier } : { mode: 'full' };
	}
	const added = current.filter((s) => !before.has(s));
	if (added.length && last.seeds) return { mode: 'incremental', frontier: added.map((address) => ({ address, depth: 0 })) };
	const ranAt = new Date(last.ran_at).getTime();
	if (Date.parse(spec.window.to) > ranAt && now - ranAt >= periodMs) return { mode: 'full' };
	return { mode: 'skip', why: Date.parse(spec.window.to) > ranAt ? 'window open; ran recently' : 'complete (window closed)' };
}
