/** GET /api/v1/snapshot/<version> — the gzip payload, byte-exact (hash in the manifest). */
import type { RequestHandler } from './$types';
import { snapshotPayload } from '$engine/index.js';
import { sql } from '$lib/server/ozone/sql';

export const GET: RequestHandler = async ({ params }) => {
	const version = Number(params.version);
	if (!Number.isSafeInteger(version) || version <= 0) return new Response('Bad version', { status: 400 });
	const payload = await snapshotPayload(sql, version).catch(() => undefined);
	if (!payload) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
	return new Response(Buffer.from(payload), {
		headers: {
			'content-type': 'application/gzip',
			'content-length': String(payload.length),
			'cache-control': 'public, max-age=31536000, immutable',
			'access-control-allow-origin': '*'
		}
	});
};
