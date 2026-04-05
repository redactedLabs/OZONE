import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { certificates } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

function generateCertId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for (let i = 0; i < 8; i++) {
		id += chars[Math.floor(Math.random() * chars.length)];
	}
	return `OZ-${id}`;
}

// POST — issue a new certificate
export const POST: RequestHandler = async ({ request }) => {
	const { address, flagged } = await request.json();

	if (!address) {
		return json({ error: 'Missing address' }, { status: 400 });
	}

	const certId = generateCertId();

	await db.insert(certificates).values({
		certId,
		address,
		flagged: flagged || false,
		sourcesChecked: 8,
	});

	const cert = await db.select().from(certificates)
		.where(eq(certificates.certId, certId))
		.limit(1);

	return json({
		certId,
		address,
		flagged: flagged || false,
		issuedAt: cert[0]?.issuedAt?.toISOString() || new Date().toISOString(),
	});
};

// GET — look up a certificate
export const GET: RequestHandler = async ({ url }) => {
	const certId = url.searchParams.get('id');

	if (!certId) {
		return json({ error: 'Missing id parameter' }, { status: 400 });
	}

	const [cert] = await db.select().from(certificates)
		.where(eq(certificates.certId, certId.toUpperCase()))
		.limit(1);

	if (!cert) {
		return json({ error: 'Certificate not found' }, { status: 404 });
	}

	return json({
		certId: cert.certId,
		address: cert.address,
		flagged: cert.flagged,
		sourcesChecked: cert.sourcesChecked,
		issuedAt: cert.issuedAt?.toISOString(),
	});
};
