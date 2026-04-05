import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { certificates } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const [cert] = await db.select().from(certificates)
		.where(eq(certificates.certId, params.id.toUpperCase()))
		.limit(1);

	if (!cert) {
		throw error(404, 'Certificate not found');
	}

	return {
		certId: cert.certId,
		address: cert.address,
		flagged: cert.flagged,
		sourcesChecked: cert.sourcesChecked,
		issuedAt: cert.issuedAt?.toISOString() || null,
	};
};
