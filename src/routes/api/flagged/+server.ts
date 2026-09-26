/**
 * GET /api/flagged[?format=csv] — THORChain accounts Ozone currently flags
 * (risk ≥ high), with the reasons. Listed and traced addresses themselves
 * are in the signed snapshot (/api/v1/snapshot).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from '$lib/server/ozone/sql';
import { coverage } from '$lib/server/ozone/stats';

interface Row {
	thor_address: string;
	flag_reason: string | null;
	risk: string | null;
	flag_detail: Array<{ via: string; code: string; source: string; risk: string; text: string }> | null;
	screened_at: string | null;
}

export const GET: RequestHandler = async ({ url }) => {
	const format = url.searchParams.get('format') || 'json';
	const rows = (
		await sql.query<Row>(
			`SELECT thor_address, flag_reason, risk, flag_detail, screened_at FROM rujira_users WHERE flagged AND thor_address LIKE 'thor1%' ORDER BY thor_address`
		)
	).rows;
	const result = rows.map((u) => ({
		thorAddress: u.thor_address,
		risk: u.risk,
		flagReason: u.flag_reason,
		reasons: u.flag_detail ?? [],
		flaggedAt: u.screened_at ? new Date(u.screened_at).toISOString() : null
	}));

	if (format === 'csv') {
		const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
		const lines = ['thor_address,risk,flag_reason,flagged_at'];
		for (const f of result) lines.push([q(f.thorAddress), q(f.risk ?? ''), q(f.flagReason ?? ''), q(f.flaggedAt ?? '')].join(','));
		return new Response(lines.join('\n'), {
			headers: {
				'Content-Type': 'text/csv',
				'Content-Disposition': `attachment; filename="ozone-flagged-thorchain-users-${new Date().toISOString().split('T')[0]}.csv"`
			}
		});
	}

	const c = await coverage();
	return json({
		meta: {
			generated: new Date().toISOString(),
			totalFlagged: result.length,
			flaggedThorUsers: result.length,
			listedAddresses: c.listed.addresses,
			tracedAddresses: c.traced.addresses,
			sources: c.listed.bySource.map((s) => s.source),
			snapshot: c.snapshot,
			note: 'Flagged THORChain accounts only. Listed and traced addresses are in the signed snapshot at /api/v1/snapshot.'
		},
		flaggedAddresses: result
	});
};
