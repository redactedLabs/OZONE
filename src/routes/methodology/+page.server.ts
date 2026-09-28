import type { PageServerLoad } from './$types';
import { SOURCES, DERIVED_SOURCES, DEFAULT_TRACE_CONFIG, CURATED, CHAIN_DEFAULTS, DEFAULT_WATCH_CONFIG, DEFAULT_WINDOW_DAYS } from '$engine/index.js';
import { coverage } from '$lib/server/ozone/stats';

export const load: PageServerLoad = async () => {
	const c = await coverage().catch(() => null);
	const live = new Map((c?.listed.bySource ?? []).map((s) => [s.source, s]));
	const sources = [...SOURCES, ...DERIVED_SOURCES].map((s) => {
		const l = live.get(s.id);
		const derivedActive = s.id === 'thorchain_trace' ? (c?.traced.addresses ?? null) : null;
		return {
			id: s.id,
			name: s.name,
			kind: s.kind,
			url: s.url,
			description: s.description,
			active: l?.active ?? derivedActive,
			removed: l?.removed ?? null,
			lastSuccessAt: l?.lastSuccessAt ?? null,
			version: l?.version ?? null,
			error: l?.error ?? null
		};
	});
	return {
		sources,
		trace: DEFAULT_TRACE_CONFIG,
		clusters: CURATED.clusters.map((k) => ({ id: k.id, name: k.name, window: k.window, minValue: k.minValue, chain: k.chain, maxDepth: k.maxDepth, ref: k.ref })),
		chainDefaults: Object.entries(CHAIN_DEFAULTS).map(([chain, p]) => ({ chain, minValue: p.minValue, maxDepth: p.maxDepth, maxRequests: p.maxRequests })),
		windowDays: DEFAULT_WINDOW_DAYS,
		watch: { minUsd: DEFAULT_WATCH_CONFIG.minUsd, hops: DEFAULT_WATCH_CONFIG.hops, lookbackDays: DEFAULT_WATCH_CONFIG.lookbackDays, maxFunders: DEFAULT_WATCH_CONFIG.maxFunders },
		incidents: CURATED.incidents.map((i) => ({
			id: i.id,
			name: i.name,
			date: i.date,
			ref: i.ref,
			chains: [...new Set(i.addresses.map((a) => a.chain))],
			addresses: i.addresses.filter((a) => !a.delisted).length,
			delisted: i.addresses.filter((a) => a.delisted).length,
			thorchain: i.thorchain,
			sourceTypes: [...new Set(i.addresses.map((a) => a.refType))],
			confidence: [...new Set(i.addresses.map((a) => a.confidence))]
		})),
		searched: CURATED.searched,
		curatedPolicy: CURATED.policy,
		coverage: c
			? {
					listed: c.listed.addresses,
					traced: c.traced.addresses,
					flaggedUsers: c.users.flagged,
					thorAccounts: c.users.thorAccounts,
					byChain: c.listed.byChain,
					delisted: c.listed.delisted,
					snapshot: c.snapshot
				}
			: null
	};
};
