/**
 * GET /api/v1/snapshot/<version>    — the gzip payload, byte-exact (hash in the manifest)
 * GET /api/v1/snapshot/<version>.<n> — part n of it, when the manifest lists parts
 *                                      (large payloads; Vercel answers at most 4.5 MB)
 */
import type { RequestHandler } from './$types';
import { snapshotPayload } from '$engine/index.js';
import { sql } from '$lib/server/ozone/sql';

export const GET: RequestHandler = async ({ params }) => {
	const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(params.version);
	if (!m) return new Response('Bad version', { status: 400 });
	const version = Number(m[1]);
	const payload = await snapshotPayload(sql, version).catch(() => undefined);
	if (!payload) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
	let body = payload;
	if (m[2] !== undefined) {
		const row = await sql.query<{ manifest: { payload?: { parts?: Array<{ size: number }> } } | string }>(
			`SELECT manifest FROM oz_snapshots WHERE version = $1`,
			[version]
		);
		const raw = row.rows[0]?.manifest;
		const manifest = typeof raw === 'string' ? JSON.parse(raw) : raw;
		const parts: Array<{ size: number }> = manifest?.payload?.parts ?? [];
		const index = Number(m[2]);
		if (index >= parts.length) return new Response('Not found', { status: 404 });
		const offset = parts.slice(0, index).reduce((n, p) => n + p.size, 0);
		body = payload.subarray(offset, offset + parts[index].size);
	}
	return new Response(Buffer.from(body), {
		headers: {
			'content-type': 'application/gzip',
			'content-length': String(body.length),
			'cache-control': 'public, max-age=31536000, immutable',
			'access-control-allow-origin': '*'
		}
	});
};
