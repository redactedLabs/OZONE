/**
 * POST /api/v1/screen   {"addresses": ["0x…", {"address": "bc1…", "chain": "BTC"}], "policy": {"flagAt": "high"}}
 * GET  /api/v1/screen?address=…&chain=…&flagAt=…
 *
 * Returns an `ozone.screen.v1` body signed with Ozone's API key (see
 * /api/v1/keys). Stateless: addresses are neither stored nor logged.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseItems, parsePolicy, screenItems, ScreenInputError } from '$lib/server/ozone/screen';

const headers = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		const text = await request.text();
		if (text.length > 64 * 1024) return json({ error: 'Request too large' }, { status: 413, headers });
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers });
	}
	try {
		const items = parseItems(body);
		const policy = parsePolicy((body as { policy?: unknown })?.policy);
		const res = await screenItems(items, policy);
		if (!res.snapshot) return json({ error: 'Screening data unavailable' }, { status: 503, headers });
		return json(res, { headers });
	} catch (e) {
		if (e instanceof ScreenInputError) return json({ error: e.message }, { status: 400, headers });
		return json({ error: 'Screening failed' }, { status: 500, headers });
	}
};

export const GET: RequestHandler = async ({ url }) => {
	const address = url.searchParams.get('address')?.trim();
	if (!address) return json({ error: 'Missing address parameter' }, { status: 400, headers });
	const res = await screenItems([{ address, chain: url.searchParams.get('chain') }], parsePolicy({ flagAt: url.searchParams.get('flagAt') }));
	if (!res.snapshot) return json({ error: 'Screening data unavailable' }, { status: 503, headers });
	return json(res, { headers });
};
