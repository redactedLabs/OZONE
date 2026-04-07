import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers, fetchL1ForUser } from '$lib/server/thorchain/midgard';
import { syncOFAC } from '$lib/server/compliance/ofac';
import { syncEU } from '$lib/server/compliance/eu';
import { syncHackList } from '$lib/server/compliance/hacks';
import { syncTether } from '$lib/server/compliance/tether';
import { screenAllUsers } from '$lib/server/compliance/screener';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import pLimit from 'p-limit';

export const config = { maxDuration: 300 };

type SyncType = 'members' | 'ofac' | 'eu' | 'hacks' | 'tether' | 'screening' | 'l1-batch' | 'l1-refetch';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { type } = await request.json() as { type: SyncType };

	try {
		switch (type) {
			case 'members':
				return json({ success: true, result: await syncAllMembers() });

			case 'ofac':
				return json({ success: true, result: await syncOFAC() });

			case 'eu':
				return json({ success: true, result: await syncEU() });

			case 'hacks':
				return json({ success: true, result: await syncHackList() });

			case 'tether':
				return json({ success: true, result: await syncTether() });

			case 'screening':
				return json({ success: true, result: await screenAllUsers() });

			case 'l1-batch': {
				// Process next 30 unfetched users
				const unfetched = await db
					.select({ thorAddress: rujiraUsers.thorAddress })
					.from(rujiraUsers)
					.where(sql`l1_fetched_at IS NULL AND thor_address LIKE 'thor%'`)
					.limit(30);

				let l1Found = 0;
				const limit = pLimit(4);
				const start = Date.now();

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
				if (unfetched.length > 0) {
					await db.insert(syncLog).values({
						type: 'L1_DISCOVERY',
						status: 'success',
						recordsProcessed: unfetched.length,
						flagsFound: l1Found,
						duration
					});
				}

				return json({ success: true, result: { processed: unfetched.length, l1Found, duration } });
			}

			case 'l1-refetch': {
				// Reset all l1_fetched_at to trigger full re-fetch over time
				const resetResult = await db.update(rujiraUsers)
					.set({ l1FetchedAt: null })
					.where(sql`thor_address LIKE 'thor%'`);

				return json({ success: true, result: { message: 'All users marked for L1 re-fetch' } });
			}

			default:
				return json({ error: `Unknown sync type: ${type}` }, { status: 400 });
		}
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};
