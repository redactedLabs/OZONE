import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers, fetchL1ForUser } from '$lib/server/thorchain/midgard';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import { runPublish, runSources, runUserScreening } from '$lib/server/ozone/jobs';

export const config = { maxDuration: 300 };

type SyncType =
	| 'members'
	| 'ofac'
	| 'uk'
	| 'eu'
	| 'fbi'
	| 'hacks'
	| 'tether'
	| 'circle'
	| 'oracle'
	| 'community'
	| 'snapshot'
	| 'screening'
	| 'l1-batch'
	| 'l1-refetch';

const SOURCE_MAP: Partial<Record<SyncType, string[]>> = {
	ofac: ['ofac_sdn'],
	uk: ['uk_fcdo'],
	eu: ['eu_fsf'],
	fbi: ['fbi'],
	hacks: ['curated', 'fbi', 'ethlabels'],
	tether: ['tether'],
	circle: ['circle'],
	oracle: ['chainalysis_oracle'],
	community: ['ethlabels', 'scamsniffer']
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'owner') return json({ error: 'Forbidden' }, { status: 403 });

	const { type } = (await request.json()) as { type: SyncType };

	try {
		const sources = SOURCE_MAP[type];
		if (sources) return json({ success: true, result: await runSources(sources) });
		switch (type) {
			case 'members':
				return json({ success: true, result: await syncAllMembers() });
			case 'snapshot':
				return json({ success: true, result: await runPublish() });
			case 'screening':
				return json({ success: true, result: await runUserScreening() });
			case 'l1-batch': {
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
							await db.update(rujiraUsers).set({ l1FetchedAt: new Date() }).where(sql`thor_address = ${u.thorAddress}`);
						})
					)
				);
				const duration = Date.now() - start;
				if (unfetched.length > 0) {
					await db.insert(syncLog).values({ type: 'L1_DISCOVERY', status: 'success', recordsProcessed: unfetched.length, flagsFound: l1Found, duration });
				}
				return json({ success: true, result: { processed: unfetched.length, l1Found, duration } });
			}
			case 'l1-refetch':
				await db.update(rujiraUsers).set({ l1FetchedAt: null }).where(sql`thor_address LIKE 'thor%'`);
				return json({ success: true, result: { message: 'All users marked for L1 re-fetch' } });
			default:
				return json({ error: `Unknown sync type: ${type}` }, { status: 400 });
		}
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};
