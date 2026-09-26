/**
 * GET /api/v1/snapshot — the newest signed snapshot manifest. The payload
 * lives at the manifest's relative `payload.url` (/api/v1/snapshot/<version>).
 * Nodes must verify the signature against pinned keys; any mirror may serve
 * these two files.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { latestSnapshot } from '$engine/index.js';
import { sql } from '$lib/server/ozone/sql';

export const GET: RequestHandler = async ({ request }) => {
	const latest = await latestSnapshot(sql).catch(() => undefined);
	if (!latest || !latest.manifest.signature) {
		return json({ error: 'No signed snapshot has been published yet' }, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
	const etag = `"oz-${latest.version}"`;
	const headers = { etag, 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' };
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
	return json(latest.manifest, { headers });
};
