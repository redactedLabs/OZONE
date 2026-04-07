import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { rujiraUsers, l1Addresses, complianceEntries, syncLog } from '$lib/server/db/schema';
import { desc, sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (locals.user.role !== 'owner') throw redirect(303, '/admin/lists');

	// User stats
	const [thorTotal] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`thor_address LIKE 'thor%'`);

	const [fetchedCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`l1_fetched_at IS NOT NULL AND thor_address LIKE 'thor%'`);

	const unfetchedCount = Number(thorTotal.count) - Number(fetchedCount.count);

	// L1 stats
	const [l1Total] = await db
		.select({ count: sql<number>`count(*)` })
		.from(l1Addresses);

	const l1ByChain = await db
		.select({
			chain: l1Addresses.chain,
			count: sql<number>`count(*)`
		})
		.from(l1Addresses)
		.groupBy(l1Addresses.chain)
		.orderBy(sql`count(*) DESC`);

	// Compliance stats
	const [complianceTotal] = await db
		.select({ count: sql<number>`count(*)` })
		.from(complianceEntries);

	const complianceBySource = await db
		.select({
			source: complianceEntries.source,
			count: sql<number>`count(*)`
		})
		.from(complianceEntries)
		.groupBy(complianceEntries.source)
		.orderBy(sql`count(*) DESC`);

	// Flagged users
	const [flaggedCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`flagged = true`);

	// Recent sync logs
	const recentLogs = await db
		.select()
		.from(syncLog)
		.orderBy(desc(syncLog.createdAt))
		.limit(20);

	// Last sync per type
	const lastSyncPerType = await db
		.select({
			type: syncLog.type,
			lastRun: sql<string>`MAX(created_at)`,
			lastStatus: sql<string>`(SELECT status FROM sync_log s2 WHERE s2.type = sync_log.type ORDER BY s2.created_at DESC LIMIT 1)`,
			lastDuration: sql<number>`(SELECT duration FROM sync_log s2 WHERE s2.type = sync_log.type ORDER BY s2.created_at DESC LIMIT 1)`,
			lastRecords: sql<number>`(SELECT records_processed FROM sync_log s2 WHERE s2.type = sync_log.type ORDER BY s2.created_at DESC LIMIT 1)`,
			totalRuns: sql<number>`COUNT(*)`,
		})
		.from(syncLog)
		.groupBy(syncLog.type);

	return {
		user: locals.user,
		stats: {
			thorUsers: Number(thorTotal.count),
			fetchedUsers: Number(fetchedCount.count),
			unfetchedUsers: unfetchedCount,
			l1Total: Number(l1Total.count),
			l1ByChain: l1ByChain.map(r => ({ chain: r.chain, count: Number(r.count) })),
			complianceTotal: Number(complianceTotal.count),
			complianceBySource: complianceBySource.map(r => ({ source: r.source, count: Number(r.count) })),
			flaggedUsers: Number(flaggedCount.count),
		},
		syncTypes: lastSyncPerType.map(s => ({
			type: s.type,
			lastRun: s.lastRun,
			lastStatus: s.lastStatus,
			lastDuration: s.lastDuration ? Number(s.lastDuration) : null,
			lastRecords: s.lastRecords ? Number(s.lastRecords) : null,
			totalRuns: Number(s.totalRuns),
		})),
		recentLogs: recentLogs.map(s => ({
			id: s.id,
			type: s.type,
			status: s.status,
			recordsProcessed: s.recordsProcessed,
			flagsFound: s.flagsFound,
			error: s.error,
			duration: s.duration,
			createdAt: s.createdAt?.toISOString()
		})),
	};
};
