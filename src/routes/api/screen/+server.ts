import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { screenSingleAddress } from '$lib/server/compliance/screener';
import { db } from '$lib/server/db';
import { rujiraUsers, l1Addresses } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fetchL1ForUser } from '$lib/server/thorchain/midgard';

export const GET: RequestHandler = async ({ url }) => {
	const address = url.searchParams.get('address');

	if (!address) {
		return json({ error: 'Missing address parameter' }, { status: 400 });
	}

	// If it's a thor address, ensure it's in DB and has L1 addresses discovered
	if (address.startsWith('thor')) {
		const [existing] = await db.select().from(rujiraUsers)
			.where(eq(rujiraUsers.thorAddress, address))
			.limit(1);

		if (!existing) {
			// Insert user
			await db.insert(rujiraUsers).values({ thorAddress: address }).onConflictDoNothing();
		}

		// Check if L1 addresses have been fetched
		const l1s = await db.select().from(l1Addresses)
			.where(eq(l1Addresses.thorAddress, address))
			.limit(1);

		if (l1s.length === 0 || !existing?.l1FetchedAt) {
			// Discover L1 addresses from Midgard (saves to DB)
			try {
				await fetchL1ForUser(address);
				await db.update(rujiraUsers)
					.set({ l1FetchedAt: new Date() })
					.where(eq(rujiraUsers.thorAddress, address));
			} catch {
				// Continue with screening even if L1 discovery fails
			}
		}
	}

	const result = await screenSingleAddress(address);
	return json(result);
};
