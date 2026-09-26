import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/ozone/sql';

interface Detail {
	via: string;
	code: string;
	source: string;
	risk: string;
	text: string;
}

export const load: PageServerLoad = async () => {
	const flagged = await sql.query<{ thor_address: string; flag_reason: string | null; screened_at: string | null; risk: string | null; flag_detail: Detail[] | null }>(
		`SELECT thor_address, flag_reason, screened_at, risk, flag_detail FROM rujira_users WHERE flagged AND thor_address LIKE 'thor1%' ORDER BY thor_address`
	);
	const [counts] = (
		await sql.query<{ total: number; thor: number }>(
			`SELECT count(*)::int AS total, count(*) FILTER (WHERE thor_address LIKE 'thor1%')::int AS thor FROM rujira_users`
		)
	).rows;
	const l1Counts = new Map(
		(
			await sql.query<{ thor_address: string; n: number }>(
				`SELECT thor_address, count(*)::int AS n FROM l1_addresses WHERE thor_address = ANY($1::text[]) GROUP BY thor_address`,
				[flagged.rows.map((r) => r.thor_address)]
			)
		).rows.map((r) => [r.thor_address, r.n])
	);

	const results = flagged.rows.map((u) => ({
		thorAddress: u.thor_address,
		flagReason: u.flag_reason,
		risk: u.risk,
		screenedAt: u.screened_at ? new Date(u.screened_at).toISOString() : null,
		l1Count: l1Counts.get(u.thor_address) ?? 0,
		matches: (u.flag_detail ?? []).map((d) => ({
			l1Address: d.via,
			chain: d.via === u.thor_address ? 'THOR' : 'linked',
			source: d.source,
			entityName: d.code,
			reason: d.text
		}))
	}));

	return {
		results,
		totalUsers: counts?.thor ?? 0,
		flaggedCount: results.length,
		cleanCount: (counts?.thor ?? 0) - results.length
	};
};
