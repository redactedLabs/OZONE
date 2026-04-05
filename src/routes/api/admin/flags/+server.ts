import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { manualFlags, complianceEntries, l1Addresses, rujiraUsers } from '$lib/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';

// GET all manual flags
export const GET: RequestHandler = async () => {
	const flags = await db
		.select()
		.from(manualFlags)
		.orderBy(desc(manualFlags.addedAt));

	return json(flags.map(f => ({
		id: f.id,
		address: f.address,
		chain: f.chain,
		reason: f.reason,
		addedBy: f.addedBy,
		addedAt: f.addedAt?.toISOString(),
		active: f.active
	})));
};

// POST add new manual flag
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { address, chain, reason } = body;

	if (!address || !reason) {
		return json({ error: 'Address and reason are required' }, { status: 400 });
	}

	// Normalize
	const normalizedAddr = ['ETH', 'BSC', 'ARB', 'BASE', 'AVAX'].includes(chain)
		? address.toLowerCase()
		: address;

	// Insert into manual_flags
	const [flag] = await db.insert(manualFlags).values({
		address: normalizedAddr,
		chain: chain || null,
		reason,
		addedBy: locals.user.email,
	}).returning();

	// Also add to compliance_entries for screening
	await db.insert(complianceEntries).values({
		address: normalizedAddr,
		chain: chain || null,
		source: 'MANUAL',
		entityName: reason,
		reason: `Manual flag by ${locals.user.email}`
	});

	// Immediately screen: check if any user has this L1 address
	const matchedL1s = await db
		.select()
		.from(l1Addresses)
		.where(eq(l1Addresses.l1Address, normalizedAddr));

	let flaggedUsers = 0;
	for (const l1 of matchedL1s) {
		await db
			.update(rujiraUsers)
			.set({
				flagged: true,
				flagReason: `MANUAL: ${reason} (${normalizedAddr.slice(0, 16)}...)`,
				screenedAt: new Date()
			})
			.where(eq(rujiraUsers.thorAddress, l1.thorAddress));
		flaggedUsers++;
	}

	// Also check if the address itself is a thor user
	const directMatch = await db
		.select()
		.from(rujiraUsers)
		.where(eq(rujiraUsers.thorAddress, normalizedAddr))
		.limit(1);

	if (directMatch.length > 0) {
		await db
			.update(rujiraUsers)
			.set({
				flagged: true,
				flagReason: `MANUAL: ${reason}`,
				screenedAt: new Date()
			})
			.where(eq(rujiraUsers.thorAddress, normalizedAddr));
		flaggedUsers++;
	}

	return json({ id: flag.id, address: normalizedAddr, chain, reason, flaggedUsers });
};

// DELETE remove a manual flag
export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { id } = body;

	if (!id) return json({ error: 'ID required' }, { status: 400 });

	// Get the flag first to remove from compliance_entries too
	const [flag] = await db.select().from(manualFlags).where(eq(manualFlags.id, id));
	if (flag) {
		await db.update(manualFlags).set({ active: false }).where(eq(manualFlags.id, id));
		await db.delete(complianceEntries).where(
			and(
				eq(complianceEntries.address, flag.address),
				eq(complianceEntries.source, 'MANUAL')
			)
		);
	}

	return json({ success: true });
};
