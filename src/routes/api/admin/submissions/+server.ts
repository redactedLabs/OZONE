/**
 * Admin review of reports and appeals.
 * GET  ?status=open|accepted|rejected
 * POST {publicId, action: "accept"|"reject", resolution}
 *   - accepted report  → maintainer flag (manual_flags), picked up by the next snapshot
 *   - accepted appeal  → suppression override for derived / community reasons;
 *     official sanctions listings cannot be suppressed (the resolution says so)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from '$lib/server/ozone/sql';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const status = url.searchParams.get('status') ?? 'open';
	const r = await sql.query(
		`SELECT public_id, kind, address, chain, key, message, evidence, contact, status, resolution, created_at, resolved_at, resolved_by
		 FROM oz_submissions WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
		[status]
	);
	return json(r.rows);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'admin' && locals.user.role !== 'owner') return json({ error: 'Forbidden' }, { status: 403 });
	const { publicId, action, resolution } = (await request.json()) as { publicId?: string; action?: string; resolution?: string };
	if (!publicId || (action !== 'accept' && action !== 'reject')) return json({ error: 'publicId and action required' }, { status: 400 });
	const r = await sql.query<{ kind: string; address: string; chain: string | null; key: string; message: string; status: string }>(
		`SELECT kind, address, chain, key, message, status FROM oz_submissions WHERE public_id = $1`,
		[publicId]
	);
	const s = r.rows[0];
	if (!s) return json({ error: 'Not found' }, { status: 404 });
	if (s.status !== 'open') return json({ error: 'Already resolved' }, { status: 409 });
	let note = (resolution ?? '').slice(0, 1000);
	if (action === 'accept' && s.kind === 'report') {
		await sql.query(`INSERT INTO manual_flags (address, chain, reason, added_by) VALUES ($1,$2,$3,$4)`, [
			s.address,
			s.chain,
			`${note || s.message.slice(0, 300)} (report ${publicId})`,
			locals.user.email
		]);
	}
	if (action === 'accept' && s.kind === 'appeal') {
		await sql.query(
			`INSERT INTO oz_overrides (key, action, reason, created_by) VALUES ($1,'suppress',$2,$3)
			 ON CONFLICT (key) DO UPDATE SET active = true, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()`,
			[s.key, `${note || 'appeal accepted'} (appeal ${publicId})`, locals.user.email]
		);
		await sql.query(`UPDATE oz_traced SET suppressed = true WHERE key = $1`, [s.key]);
		const official = await sql.query<{ source: string }>(
			`SELECT DISTINCT source FROM oz_entries WHERE key = $1 AND removed_at IS NULL AND category IN ('sanctions','law_enforcement')`,
			[s.key]
		);
		if (official.rows.length) {
			note += ` Official listing(s) remain (${official.rows.map((o) => o.source).join(', ')}): only the listing authority can delist.`;
		}
	}
	await sql.query(
		`UPDATE oz_submissions SET status = $2, resolution = $3, resolved_at = now(), resolved_by = $4 WHERE public_id = $1`,
		[publicId, action === 'accept' ? 'accepted' : 'rejected', note.trim() || null, locals.user.email]
	);
	return json({ ok: true, note: note.trim() });
};
