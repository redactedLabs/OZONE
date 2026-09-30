import type { PageServerLoad } from './$types';
import { currentSnapshot } from '$lib/server/ozone/snapshot';
import { coverage } from '$lib/server/ozone/stats';
import { DEFINITIONS, flaggedPage, flaggedSummary, parseListName } from '$lib/server/ozone/flagged';

const PER_PAGE = 50;

/**
 * The two flagged lists (all chains; thor1 only), from the newest signed
 * snapshot: only what the snapshot publishes, nothing from the database.
 */
export const load: PageServerLoad = async ({ url }) => {
	const list = parseListName(url.searchParams.get('list')) ?? 'all';
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 128);
	const source = (url.searchParams.get('source') ?? '').trim().slice(0, 64);
	const chain = (url.searchParams.get('chain') ?? '').trim().toUpperCase().slice(0, 16);
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1);
	const [snap, c] = await Promise.all([currentSnapshot().catch(() => undefined), coverage().catch(() => null)]);
	const base = { list, q, source, chain, page, perPage: PER_PAGE, definitions: DEFINITIONS, monitoredFlagged: c?.users.flagged ?? null };
	if (!snap) {
		return { ...base, ready: false as const, total: 0, rows: [], counts: null, byKind: null, linkedAccounts: 0, bySource: [], byChain: [], snapshot: null };
	}
	const s = flaggedSummary(snap.index);
	const res = flaggedPage(s, { list, q, source, chain: list === 'thor' ? undefined : chain, offset: (page - 1) * PER_PAGE, limit: PER_PAGE });
	return {
		...base,
		ready: true as const,
		total: res.total,
		rows: res.rows,
		counts: s.counts,
		byKind: list === 'thor' ? s.thorByKind : s.byKind,
		linkedAccounts: s.linkedAccounts,
		bySource: list === 'thor' ? s.thorBySource : s.bySource,
		byChain: list === 'thor' ? [] : s.byChain,
		snapshot: { ...s.snapshot, signed: snap.signed }
	};
};
