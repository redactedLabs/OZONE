import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { transactions, syncLog, rujiraUsers } from '$lib/server/db/schema';
import { desc, sql, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	// Recent transactions from WebSocket
	const recentTxs = await db
		.select()
		.from(transactions)
		.orderBy(desc(transactions.timestamp))
		.limit(50);

	// Sync logs
	const recentSyncs = await db
		.select()
		.from(syncLog)
		.orderBy(desc(syncLog.createdAt))
		.limit(20);

	// TX stats
	const [txTotal] = await db.select({ count: sql<number>`count(*)` }).from(transactions);
	const txByType = await db
		.select({ type: transactions.memoType, count: sql<number>`count(*)` })
		.from(transactions)
		.groupBy(transactions.memoType);

	// User growth (last 7 days count)
	const [usersTotal] = await db.select({ count: sql<number>`count(*)` }).from(rujiraUsers);
	const [usersRecent] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`first_seen > NOW() - INTERVAL '7 days'`);

	return {
		user: locals.user,
		transactions: recentTxs.map(t => ({
			id: t.id,
			txHash: t.txHash,
			blockHeight: t.blockHeight,
			memo: t.memo,
			memoType: t.memoType,
			fromAddress: t.fromAddress,
			toAddress: t.toAddress,
			asset: t.asset,
			amount: t.amount,
			chain: t.chain,
			timestamp: t.timestamp?.toISOString()
		})),
		syncLogs: recentSyncs.map(s => ({
			id: s.id,
			type: s.type,
			status: s.status,
			recordsProcessed: s.recordsProcessed,
			flagsFound: s.flagsFound,
			error: s.error,
			duration: s.duration,
			createdAt: s.createdAt?.toISOString()
		})),
		stats: {
			totalTxs: Number(txTotal.count),
			txByType: txByType.map(t => ({ type: t.type || 'UNKNOWN', count: Number(t.count) })),
			totalUsers: Number(usersTotal.count),
			newUsersLast7d: Number(usersRecent.count),
		}
	};
};
