import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { rujiraUsers, l1Addresses, complianceEntries } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const format = url.searchParams.get('format') || 'json';

	// Get all flagged users
	const flagged = await db.select().from(rujiraUsers)
		.where(eq(rujiraUsers.flagged, true));

	// Get their L1 addresses
	const allL1 = flagged.length > 0
		? await db.select().from(l1Addresses)
		: [];

	// Build L1 lookup
	const l1Map = new Map<string, Array<{ address: string; chain: string }>>();
	for (const l1 of allL1) {
		const list = l1Map.get(l1.thorAddress) || [];
		list.push({ address: l1.l1Address, chain: l1.chain });
		l1Map.set(l1.thorAddress, list);
	}

	const result = flagged.map(u => ({
		thorAddress: u.thorAddress,
		flagReason: u.flagReason,
		flaggedAt: u.screenedAt?.toISOString() || null,
		linkedAddresses: l1Map.get(u.thorAddress) || [],
	}));

	// Stats
	const [totalCompliance] = await db.select({ count: sql<number>`count(*)` }).from(complianceEntries);

	const response = {
		meta: {
			generated: new Date().toISOString(),
			totalFlagged: result.length,
			totalComplianceEntries: Number(totalCompliance.count),
			sources: ['OFAC', 'EU', 'HACK', 'TETHER', 'SCAM', 'ETH_LABELS', 'CHAINALYSIS', 'MANUAL'],
		},
		flaggedAddresses: result,
	};

	if (format === 'csv') {
		const lines = ['thor_address,flag_reason,flagged_at,linked_addresses'];
		for (const f of result) {
			const linked = f.linkedAddresses.map(l => `${l.chain}:${l.address}`).join('|');
			lines.push(`"${f.thorAddress}","${(f.flagReason || '').replace(/"/g, '""')}","${f.flaggedAt || ''}","${linked}"`);
		}
		return new Response(lines.join('\n'), {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': `attachment; filename="redacted-flagged-${new Date().toISOString().split('T')[0]}.csv"`,
			},
		});
	}

	return json(response);
};
