import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers, fetchL1ForUser } from '$lib/server/thorchain/midgard';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import { runPublish, runSources, runUserScreening, syncInApp } from '$lib/server/ozone/jobs';
import { isAuthorizedAdminRequest } from '$lib/server/request-auth';

// Allow up to 300s (Vercel Pro max)
export const config = { maxDuration: 300 };

/**
 * Vercel cron (every 30 min). User/L1 discovery always runs here; list
 * ingestion, snapshot publishing and user screening only when
 * OZONE_SYNC_IN_APP=1 — normally the worker does them (see INTEGRATION.md).
 */
async function runSync() {
	const start = Date.now();
	const results: Record<string, unknown> = {};
	const errors: string[] = [];

	try {
		results.members = await syncAllMembers();
	} catch (e) {
		errors.push(`Members: ${e}`);
	}

	if (syncInApp()) {
		try {
			results.sources = (await runSources()).map((o) => ({ source: o.source, ok: o.ok, active: o.stats?.active, error: o.error }));
			results.snapshot = await runPublish();
			results.users = await runUserScreening();
		} catch (e) {
			errors.push(`Ozone engine: ${e}`);
		}
	} else {
		results.lists = 'skipped: list sync, tracing and screening run in OZONE-WORKER';
	}

	// L1 discovery — 30 unfetched thor users per run
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
					await db.update(rujiraUsers).set({ l1FetchedAt: new Date() }).where(sql`thor_address = ${u.thorAddress}`);
				})
			)
		);
		results.l1Discovery = { processed: unfetched.length, l1Found, duration: Date.now() - l1Start };
		if (unfetched.length > 0) {
			await db.insert(syncLog).values({
				type: 'L1_DISCOVERY',
				status: 'success',
				recordsProcessed: unfetched.length,
				flagsFound: l1Found,
				duration: Date.now() - l1Start
			});
		}
	} catch (e) {
		errors.push(`L1 Discovery: ${e}`);
	}

	return json({ duration: Date.now() - start, results, errors: errors.length > 0 ? errors : undefined });
}

// Cron target (vercel.json) as well as an admin action, so — unlike the
// admin-only endpoints — this accepts either a session or CRON_SECRET's
// bearer token. Defense in depth alongside hooks.server.ts (see
// ozone-hook-gate-encoded-pathname-bypass).
const guard = ({ request, locals }: { request: Request; locals: App.Locals }) =>
	isAuthorizedAdminRequest(request, locals.user) ? null : json({ error: 'Unauthorized' }, { status: 401 });

export const GET: RequestHandler = async (event) => guard(event) ?? runSync();
export const POST: RequestHandler = async (event) => guard(event) ?? runSync();
