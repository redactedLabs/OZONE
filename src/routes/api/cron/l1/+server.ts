import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchL1ForUser } from '$lib/server/thorchain/midgard';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import pLimit from 'p-limit';

// Dedicated L1 discovery cron — lightweight, runs every 10 min
// Processes 100 unfetched users per run = ~14,400/day
export const config = { maxDuration: 300 };

async function discoverL1() {
	const start = Date.now();

	const unfetched = await db
		.select({ thorAddress: rujiraUsers.thorAddress })
		.from(rujiraUsers)
		.where(sql`l1_fetched_at IS NULL AND thor_address LIKE 'thor%'`)
		.limit(100);

	if (unfetched.length === 0) {
		return json({ processed: 0, l1Found: 0, remaining: 0, duration: Date.now() - start });
	}

	let l1Found = 0;
	const limit = pLimit(5);

	await Promise.allSettled(
		unfetched.map((u) =>
			limit(async () => {
				const result = await fetchL1ForUser(u.thorAddress);
				l1Found += result.found;
				await db.update(rujiraUsers)
					.set({ l1FetchedAt: new Date() })
					.where(sql`thor_address = ${u.thorAddress}`);
			})
		)
	);

	const duration = Date.now() - start;

	// Count remaining
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(rujiraUsers)
		.where(sql`l1_fetched_at IS NULL AND thor_address LIKE 'thor%'`);

	await db.insert(syncLog).values({
		type: 'L1_DISCOVERY',
		status: 'success',
		recordsProcessed: unfetched.length,
		flagsFound: l1Found,
		duration
	}).catch(() => {});

	return json({ processed: unfetched.length, l1Found, remaining: Number(count), duration });
}

export const GET: RequestHandler = async () => discoverL1();
export const POST: RequestHandler = async () => discoverL1();
