/**
 * GET /api/screen?address=… — the original endpoint, kept compatible
 * (`flagged` + `matches[].source`) for existing integrations, now backed by
 * the v1 verdict engine. It no longer stores the queried address or runs an
 * L1 discovery on the request path (privacy, latency).
 *
 * `attestation` carries the signed `ozone.screen.v1` answer for callers that
 * want verifiable evidence.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { legacyVerdict, screenItems } from '$lib/server/ozone/screen';

export const GET: RequestHandler = async ({ url }) => {
	const headers = { 'cache-control': 'no-store' };
	const address = url.searchParams.get('address')?.trim();
	if (!address) return json({ error: 'Missing address parameter' }, { status: 400, headers });
	if (address.length > 128) return json({ error: 'Invalid address' }, { status: 400, headers });
	const res = await screenItems([{ address, chain: url.searchParams.get('chain') }]);
	if (!res.snapshot || !res.results[0]) return json({ error: 'Screening data unavailable' }, { status: 503, headers });
	const v = res.results[0];
	if (v.status === 'invalid') return json({ error: 'Not a valid address for a supported chain', address }, { status: 400, headers });
	return json({ ...legacyVerdict(v), attestation: res }, { headers });
};
