import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { rujiraUsers, syncLog } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { coverage } from '$lib/server/ozone/stats';

export const GET: RequestHandler = async () => {
	const c = await coverage();
	const src = (id: string) => c.listed.bySource.find((s) => s.source === id)?.active ?? 0;
	const hacks = c.listed.byCategory
		.filter((x) => ['hack', 'exploit', 'law_enforcement'].includes(x.category))
		.reduce((n, x) => n + x.addresses, 0);

	const recentFlags = await db.select().from(rujiraUsers).where(eq(rujiraUsers.flagged, true)).orderBy(desc(rujiraUsers.screenedAt)).limit(5);
	const recentSyncs = await db.select().from(syncLog).orderBy(desc(syncLog.createdAt)).limit(10);

	return json(
		{
			// v2 — each number means one thing (see /methodology)
			listedAddresses: c.listed.addresses,
			listedOnThorchainChains: c.listed.thorchainChains,
			tracedAddresses: c.traced.addresses,
			tracedFlows: c.traced.flows,
			flaggedThorUsers: c.users.flagged,
			monitoredThorAccounts: c.users.thorAccounts,
			linkedL1Addresses: c.users.linkedL1,
			delistedAddresses: c.listed.delisted,
			bySource: c.listed.bySource,
			byChain: c.listed.byChain,
			tracedByHop: c.traced.byHop,
			snapshot: c.snapshot,
			// legacy fields (same names as before, corrected meaning)
			totalUsers: c.users.accounts,
			flaggedUsers: c.users.flagged,
			ofacEntries: src('ofac_sdn'),
			euEntries: src('eu_fsf'),
			hackEntries: hacks,
			totalListEntries: c.listed.addresses,
			lastSync: c.listed.bySource.map((s) => s.lastSuccessAt).filter(Boolean).sort().pop() ?? null,
			recentFlags: recentFlags.map((u) => ({ thorAddress: u.thorAddress, flagReason: u.flagReason, screenedAt: u.screenedAt })),
			recentSyncs: recentSyncs.map((s) => ({
				type: s.type,
				status: s.status,
				recordsProcessed: s.recordsProcessed,
				flagsFound: s.flagsFound,
				duration: s.duration,
				createdAt: s.createdAt,
				error: s.error
			}))
		},
		{ headers: { 'cache-control': 'public, max-age=60' } }
	);
};
