import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { manualFlags } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { parseListedAddress } from '$ozone/index.js';

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

	// Validate + normalize (checksums; EVM lower-case, bech32 lower-case, base58 exact)
	const parsed = parseListedAddress(address, chain);
	if (!parsed) return json({ error: 'Not a valid address for a supported chain' }, { status: 400 });
	const normalizedAddr = parsed.parsed.address;

	const [flag] = await db.insert(manualFlags).values({
		address: normalizedAddr,
		chain: parsed.parsed.chain,
		reason,
		addedBy: locals.user.email,
	}).returning();

	// Maintainer flags enter the next snapshot (built by the worker every few
	// minutes) and from there every verdict, node and user screening.
	return json({ id: flag.id, address: normalizedAddr, chain: parsed.parsed.chain, reason, key: parsed.parsed.key });
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
		// soft delete: the next snapshot no longer contains it
		await db.update(manualFlags).set({ active: false }).where(eq(manualFlags.id, id));
	}

	return json({ success: true });
};
