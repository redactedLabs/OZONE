import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers, fetchL1ForUser } from '$lib/server/thorchain/midgard';
import { syncOFAC } from '$lib/server/compliance/ofac';
import { syncEU } from '$lib/server/compliance/eu';
import { syncHackList } from '$lib/server/compliance/hacks';
import { screenAllUsers } from '$lib/server/compliance/screener';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import { env } from '$env/dynamic/private';

// Allow up to 300s for full sync (Vercel Pro max): League pagination + cosmos linking + compliance lists + screening
export const config = { maxDuration: 300 };

async function runSync() {
	const start = Date.now();
	const results: Record<string, any> = {};
	const errors: string[] = [];

	// Step 1: Fetch all members (fast — single API call)
	try {
		results.members = await syncAllMembers();
	} catch (e) {
		errors.push(`Members: ${e}`);
		results.members = { error: String(e) };
	}

	// Step 2: Compliance lists
	try {
		results.hacks = await syncHackList();
	} catch (e) {
		errors.push(`Hacks: ${e}`);
	}

	try {
		results.ofac = await syncOFAC();
	} catch (e) {
		errors.push(`OFAC: ${e}`);
	}

	try {
		results.eu = await syncEU();
	} catch (e) {
		errors.push(`EU: ${e}`);
	}

	// Step 3: Screen
	try {
		results.screening = await screenAllUsers();
	} catch (e) {
		errors.push(`Screening: ${e}`);
	}

	// Step 4: L1 Discovery — process 30 unfetched thor users per cron run
	try {
		const l1Start = Date.now();
		const unfetched = await db
			.select({ thorAddress: rujiraUsers.thorAddress })
			.from(rujiraUsers)
			.where(sql`l1_fetched_at IS NULL AND thor_address LIKE 'thor%'`)
			.limit(30);

		let l1Found = 0;
		const limit = pLimit(4);

		await Promise.allSettled(
			unfetched.map((u) =>
				limit(async () => {
					const result = await fetchL1ForUser(u.thorAddress);
					l1Found += result.found;
					// Mark as fetched
					await db.update(rujiraUsers)
						.set({ l1FetchedAt: new Date() })
						.where(sql`thor_address = ${u.thorAddress}`);
				})
			)
		);

		const l1Duration = Date.now() - l1Start;
		results.l1Discovery = { processed: unfetched.length, l1Found, duration: l1Duration };

		if (unfetched.length > 0) {
			await db.insert(syncLog).values({
				type: 'L1_DISCOVERY',
				status: 'success',
				recordsProcessed: unfetched.length,
				flagsFound: l1Found,
				duration: l1Duration
			});
		}
	} catch (e) {
		errors.push(`L1 Discovery: ${e}`);
		results.l1Discovery = { error: String(e) };
		await db.insert(syncLog).values({
			type: 'L1_DISCOVERY',
			status: 'error',
			recordsProcessed: 0,
			flagsFound: 0,
			error: String(e),
			duration: 0
		}).catch(() => {});
	}

	return json({
		duration: Date.now() - start,
		results,
		errors: errors.length > 0 ? errors : undefined
	});
}

// GET for Vercel Cron
export const GET: RequestHandler = async () => runSync();

// POST for manual trigger
export const POST: RequestHandler = async () => runSync();
