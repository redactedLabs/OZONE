import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { user, syncLog, complianceEntries } from '$lib/server/db/schema';
import { desc, sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const users = await db.select().from(user).orderBy(desc(user.createdAt));

	const syncStats = await db
		.select({
			type: syncLog.type,
			lastRun: sql<string>`MAX(created_at)`,
			lastStatus: sql<string>`(SELECT status FROM sync_log s2 WHERE s2.type = sync_log.type ORDER BY s2.created_at DESC LIMIT 1)`,
			totalRuns: sql<number>`COUNT(*)`,
		})
		.from(syncLog)
		.groupBy(syncLog.type);

	const complianceBySource = await db
		.select({
			source: complianceEntries.source,
			count: sql<number>`count(*)`
		})
		.from(complianceEntries)
		.groupBy(complianceEntries.source);

	const complianceCounts: Record<string, number> = {};
	for (const r of complianceBySource) {
		complianceCounts[r.source] = Number(r.count);
	}

	return {
		user: locals.user,
		adminUsers: users.map(u => ({
			id: u.id,
			email: u.email,
			name: u.name,
			role: u.role || 'admin',
			createdAt: u.createdAt?.toISOString(),
		})),
		syncStats: syncStats.map(s => ({
			type: s.type,
			lastRun: s.lastRun,
			lastStatus: s.lastStatus,
			totalRuns: Number(s.totalRuns),
			dbCount: complianceCounts[s.type] ?? null,
		})),
	};
};
