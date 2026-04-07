import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchL1ForUser } from '$lib/server/thorchain/midgard';
import { db } from '$lib/server/db';
import { rujiraUsers, l1Addresses } from '$lib/server/db/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import pLimit from 'p-limit';

export const config = { maxDuration: 300 };

/**
 * Fetches L1 addresses in batches that fit within Vercel's timeout.
 * Call repeatedly until done=true.
 */
export const POST: RequestHandler = async ({ url }) => {
	const batchSize = parseInt(url.searchParams.get('batch') || '20');
	const refetch = url.searchParams.get('refetch') === 'true';
	const start = Date.now();

	// If refetch=true, reset all l1_fetched_at to force re-scan
	if (refetch) {
		await db.update(rujiraUsers).set({ l1FetchedAt: null });
	}

	// Get users whose L1 addresses haven't been fetched yet
	const usersToFetch = await db
		.select({ thorAddress: rujiraUsers.thorAddress })
		.from(rujiraUsers)
		.where(isNull(rujiraUsers.l1FetchedAt))
		.limit(batchSize);

	if (usersToFetch.length === 0) {
		const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(rujiraUsers);
		const [l1Result] = await db.select({ count: sql<number>`count(*)` }).from(l1Addresses);
		return json({
			done: true,
			totalUsers: Number(totalResult.count),
			totalL1: Number(l1Result.count),
			processed: 0,
			duration: Date.now() - start
		});
	}

	const [remainingResult] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(isNull(rujiraUsers.l1FetchedAt));
	const remaining = Number(remainingResult.count);

	const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(rujiraUsers);
	const total = Number(totalResult.count);

	const limit = pLimit(4);
	let l1Found = 0;

	// Only fetch from Midgard for thor addresses
	const thorUsers = usersToFetch.filter(u => u.thorAddress.startsWith('thor'));
	const nonThorUsers = usersToFetch.filter(u => !u.thorAddress.startsWith('thor'));

	await Promise.allSettled(
		thorUsers.map(user =>
			limit(async () => {
				const result = await fetchL1ForUser(user.thorAddress);
				l1Found += result.found;
				await db
					.update(rujiraUsers)
					.set({ l1FetchedAt: new Date() })
					.where(eq(rujiraUsers.thorAddress, user.thorAddress));
			})
		)
	);

	// Non-thor users are already L1 addresses — mark them as fetched
	for (const user of nonThorUsers) {
		await db
			.update(rujiraUsers)
			.set({ l1FetchedAt: new Date() })
			.where(eq(rujiraUsers.thorAddress, user.thorAddress));
	}

	const [l1TotalResult] = await db.select({ count: sql<number>`count(*)` }).from(l1Addresses);

	return json({
		done: false,
		processed: usersToFetch.length,
		remaining: remaining - usersToFetch.length,
		total,
		l1Found,
		totalL1: Number(l1TotalResult.count),
		duration: Date.now() - start
	});
};
