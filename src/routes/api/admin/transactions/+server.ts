import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { transactions } from '$lib/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

// Not a cron target (unlike /api/sync/* and /api/cron/l1): a plain session
// check, no CRON_SECRET fallback. Defense in depth alongside hooks.server.ts
// — this must not depend solely on that hook's routing (see
// ozone-hook-gate-encoded-pathname-bypass).
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = parseInt(url.searchParams.get('limit') || '50');
	const memoType = url.searchParams.get('type') || '';

	let query = db.select().from(transactions);

	if (memoType) {
		query = query.where(eq(transactions.memoType, memoType)) as any;
	}

	const txs = await (query as any)
		.orderBy(desc(transactions.timestamp))
		.limit(limit);

	// Get stats
	const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(transactions);
	const typeStats = await db
		.select({
			memoType: transactions.memoType,
			count: sql<number>`count(*)`
		})
		.from(transactions)
		.groupBy(transactions.memoType);

	return json({
		transactions: txs.map((t: any) => ({
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
		total: Number(totalResult.count),
		typeStats: typeStats.map(s => ({ type: s.memoType, count: Number(s.count) }))
	});
};
