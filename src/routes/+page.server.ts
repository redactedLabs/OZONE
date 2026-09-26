import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { coverage, dailyDeltas } from '$lib/server/ozone/stats';

export const load: PageServerLoad = async ({ locals }) => {
	const [c, d] = await Promise.all([coverage(), dailyDeltas()]);

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
			// one meaning per number — see /methodology
			monitoredThorAccounts: c.users.thorAccounts,
			listedAddresses: c.listed.addresses,
			tracedAddresses: c.traced.addresses,
			flaggedThorUsers: c.users.flagged,
			linkedL1: c.users.linkedL1,
			sources: c.listed.bySource.filter((s) => s.active > 0).length,
			newAccountsDay: Number(d.users),
			newListedDay: Number(d.listed),
			newTracedDay: Number(d.traced),
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
