import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { sql } from '$lib/server/ozone/sql';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const status = ['open', 'accepted', 'rejected'].includes(url.searchParams.get('status') ?? '') ? url.searchParams.get('status')! : 'open';
	const rows = await sql.query<{
		public_id: string;
		kind: string;
		address: string;
		chain: string | null;
		key: string | null;
		message: string;
		evidence: string | null;
		contact: string | null;
		status: string;
		resolution: string | null;
		created_at: string;
		resolved_by: string | null;
	}>(
		`SELECT public_id, kind, address, chain, key, message, evidence, contact, status, resolution, created_at, resolved_by
		 FROM oz_submissions WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
		[status]
	);
	return {
		status,
		items: rows.rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }))
	};
};
