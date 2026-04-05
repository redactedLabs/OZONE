import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	complianceEntries,
	rujiraUsers,
	syncLog
} from '$lib/server/db/schema';
import { eq, desc, count, and } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
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

	return json({
		totalUsers: totalUsersResult.count,
		flaggedUsers: flaggedUsersResult.count,
		ofacEntries: ofacResult.count,
		euEntries: euResult.count,
		hackEntries: hackResult.count,
		totalListEntries:
			ofacResult.count + euResult.count + hackResult.count,
		lastSync: lastSyncEntry[0]?.createdAt || null,
		recentFlags: recentFlags.map((u) => ({
			thorAddress: u.thorAddress,
			flagReason: u.flagReason,
			screenedAt: u.screenedAt
		})),
		recentSyncs: recentSyncs.map((s) => ({
			type: s.type,
			status: s.status,
			recordsProcessed: s.recordsProcessed,
			flagsFound: s.flagsFound,
			duration: s.duration,
			createdAt: s.createdAt,
			error: s.error
		}))
	});
};
