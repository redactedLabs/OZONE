import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { coverage, dailyDeltas, followerState } from '$lib/server/ozone/stats';
import { currentSnapshot } from '$lib/server/ozone/snapshot';
import { flaggedSummary } from '$lib/server/ozone/flagged';

export const load: PageServerLoad = async ({ locals }) => {
	const [c, d, snap, follower] = await Promise.all([coverage(), dailyDeltas(), currentSnapshot().catch(() => undefined), followerState().catch(() => null)]);
	// the two flagged numbers come from the signed snapshot (what nodes screen against)
	const flagged = snap ? flaggedSummary(snap.index) : undefined;

	const lastSync = c.listed.bySource.map((s) => s.lastSuccessAt).filter(Boolean).sort().pop() ?? null;

	const recentFlags = await db
		.select()
		.from(rujiraUsers)
		.where(eq(rujiraUsers.flagged, true))
		.orderBy(desc(rujiraUsers.screenedAt))
		.limit(5);

	const recentSyncs = await db.select().from(syncLog).orderBy(desc(syncLog.createdAt)).limit(10);

	return {
		user: locals.user,
		stats: {
			// one meaning per number, each shown once — see /methodology#numbers
			monitoredThorAccounts: c.users.thorAccounts,
			listedAddresses: c.listed.addresses,
			// (1) every flagged address, all chains; (2) the thor1 ones among them
			flaggedAddresses: flagged?.counts.flaggedAddresses ?? null,
			flaggedThorAddresses: flagged?.counts.flaggedThorAddresses ?? null,
			// the newest THORChain block the real-time follower traced (the pill under the globe)
			follower,
			// monitored thor1 accounts flagged themselves or through a linked L1 address (formerly "Flagged THORChain Users")
			monitoredAccountsFlagged: c.users.flagged,
			linkedL1: c.users.linkedL1,
			sources: c.listed.bySource.filter((s) => s.active > 0).length,
			newAccountsDay: Number(d.users),
			newListedDay: Number(d.listed),
			lastSync,
			snapshotVersion: c.snapshot?.version ?? null
		},
		recentFlags: recentFlags.map((u) => ({
			thorAddress: u.thorAddress,
			flagReason: u.flagReason,
			screenedAt: u.screenedAt?.toISOString() || null
		})),
		recentSyncs: recentSyncs.map((s) => ({
			type: s.type,
			status: s.status,
			recordsProcessed: s.recordsProcessed,
			flagsFound: s.flagsFound,
			duration: s.duration,
			createdAt: s.createdAt?.toISOString() || null,
			error: s.error
		}))
	};
};
