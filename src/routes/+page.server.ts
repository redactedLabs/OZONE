import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { complianceEntries, rujiraUsers, l1Addresses, syncLog } from '$lib/server/db/schema';
import { eq, desc, count, sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const [totalUsersResult] = await db
		.select({ count: count() })
		.from(rujiraUsers);

	const [flaggedUsersResult] = await db
		.select({ count: count() })
		.from(rujiraUsers)
		.where(eq(rujiraUsers.flagged, true));

	const [ofacResult] = await db
		.select({ count: count() })
		.from(complianceEntries)
		.where(eq(complianceEntries.source, 'OFAC'));

	const [euResult] = await db
		.select({ count: count() })
		.from(complianceEntries)
		.where(eq(complianceEntries.source, 'EU'));

	const [hackResult] = await db
		.select({ count: count() })
		.from(complianceEntries)
		.where(eq(complianceEntries.source, 'HACK'));

	const [totalListResult] = await db
		.select({ count: count() })
		.from(complianceEntries);

	// Daily counters
	const [newUsersDay] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`first_seen > NOW() - INTERVAL '24 hours'`);

	const [newListEntriesDay] = await db
		.select({ count: sql<number>`count(*)` })
		.from(complianceEntries)
		.where(sql`added_at > NOW() - INTERVAL '24 hours'`);

	const [newBlockedDay] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`flagged = true AND screened_at > NOW() - INTERVAL '24 hours'`);

	const [totalL1Result] = await db
		.select({ count: sql<number>`count(DISTINCT l1_address || ':' || chain)` })
		.from(l1Addresses);

	const [newL1Day] = await db
		.select({ count: sql<number>`count(DISTINCT l1_address || ':' || chain)` })
		.from(l1Addresses)
		.where(sql`discovered_at > NOW() - INTERVAL '24 hours'`);

	const lastSyncEntry = await db
		.select()
		.from(syncLog)
		.orderBy(desc(syncLog.createdAt))
		.limit(1);

	const recentFlags = await db
		.select()
		.from(rujiraUsers)
		.where(eq(rujiraUsers.flagged, true))
		.orderBy(desc(rujiraUsers.screenedAt))
		.limit(5);

	const recentSyncs = await db
		.select()
		.from(syncLog)
		.orderBy(desc(syncLog.createdAt))
		.limit(10);

	// Get flagged users' L1 addresses for globe markers
	const flaggedUsers = await db
		.select()
		.from(rujiraUsers)
		.where(eq(rujiraUsers.flagged, true));

	const flaggedL1s = flaggedUsers.length > 0
		? await db
				.select()
				.from(l1Addresses)
				.where(
					eq(l1Addresses.thorAddress, flaggedUsers[0]?.thorAddress || '')
				)
		: [];

	return {
		user: locals.user,
		stats: {
			totalUsers: totalUsersResult.count,
			flaggedUsers: flaggedUsersResult.count,
			ofacEntries: ofacResult.count,
			euEntries: euResult.count,
			hackEntries: hackResult.count,
			totalListEntries: totalListResult.count,
			totalL1: Number(totalL1Result.count),
			newUsersDay: Number(newUsersDay.count),
			newL1Day: Number(newL1Day.count),
			newListEntriesDay: Number(newListEntriesDay.count),
			newBlockedDay: Number(newBlockedDay.count),
			lastSync: lastSyncEntry[0]?.createdAt?.toISOString() || null,
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
