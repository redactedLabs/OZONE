import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { rujiraUsers, l1Addresses, complianceEntries } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Get all flagged users with their details
	const flaggedUsers = await db
		.select()
		.from(rujiraUsers)
		.where(eq(rujiraUsers.flagged, true))
		.orderBy(desc(rujiraUsers.screenedAt));

	const results = await Promise.all(
		flaggedUsers.map(async (user) => {
			const l1s = await db
				.select()
				.from(l1Addresses)
				.where(eq(l1Addresses.thorAddress, user.thorAddress));

			// Find which L1 addresses matched compliance entries
			const matchDetails = [];
			for (const l1 of l1s) {
				const normalized =
					l1.chain === 'ETH' ? l1.l1Address.toLowerCase() : l1.l1Address;

				const matches = await db
					.select()
					.from(complianceEntries)
					.where(eq(complianceEntries.address, normalized));

				for (const match of matches) {
					matchDetails.push({
						l1Address: l1.l1Address,
						chain: l1.chain,
						source: match.source,
						entityName: match.entityName,
						reason: match.reason
					});
				}
			}

			return {
				thorAddress: user.thorAddress,
				flagReason: user.flagReason,
				screenedAt: user.screenedAt?.toISOString() || null,
				l1Count: l1s.length,
				matches: matchDetails
			};
		})
	);

	// Also get clean users count for stats
	const allUsers = await db.select().from(rujiraUsers);

	return {
		results,
		totalUsers: allUsers.length,
		flaggedCount: flaggedUsers.length,
		cleanCount: allUsers.length - flaggedUsers.length
	};
};
