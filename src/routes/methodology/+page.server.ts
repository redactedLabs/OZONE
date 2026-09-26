import type { PageServerLoad } from './$types';
import { SOURCES, DERIVED_SOURCES, DEFAULT_TRACE_CONFIG, CURATED } from '$engine/index.js';
import { coverage } from '$lib/server/ozone/stats';

export const load: PageServerLoad = async () => {
	const c = await coverage().catch(() => null);
	const live = new Map((c?.listed.bySource ?? []).map((s) => [s.source, s]));
	const sources = [...SOURCES, ...DERIVED_SOURCES].map((s) => {
		const l = live.get(s.id);
		return {
			id: s.id,
			name: s.name,
			kind: s.kind,
			url: s.url,
			description: s.description,
			active: l?.active ?? null,
			removed: l?.removed ?? null,
			lastSuccessAt: l?.lastSuccessAt ?? null,
			version: l?.version ?? null,
			error: l?.error ?? null
		};
	});
	return {
		sources,
		trace: DEFAULT_TRACE_CONFIG,
		clusters: CURATED.clusters.map((k) => ({ id: k.id, name: k.name, window: k.window, minValueEth: k.minValueEth, maxDepth: k.maxDepth, ref: k.ref })),
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
