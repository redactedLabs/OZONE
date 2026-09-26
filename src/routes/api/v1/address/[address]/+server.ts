/**
 * GET /api/v1/address/<address>?chain= — everything Ozone knows about one
 * address: the verdict (from the current snapshot), every list entry with
 * provenance (history included) and every THORChain flow that reached it
 * (up to 100), plus the flows it sent from flagged status. Read-only,
 * nothing stored.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addressReadings } from '$ozone/index.js';
import { screenItems } from '$lib/server/ozone/screen';
import { sql } from '$lib/server/ozone/sql';

export const GET: RequestHandler = async ({ params, url }) => {
	const headers = { 'cache-control': 'no-store' };
	const address = decodeURIComponent(params.address).trim();
	const chain = url.searchParams.get('chain');
	const readings = addressReadings(address, chain);
	if (!readings.length) return json({ error: 'Not a valid address for a supported chain' }, { status: 400, headers });
	const keys = readings.map((r) => r.key);
	const res = await screenItems([{ address, chain }]);
	if (!res.snapshot) return json({ error: 'Screening data unavailable' }, { status: 503, headers });
	const entries = await sql.query(
		`SELECT source, chain, address, category, risk, code, entity, reason, ref_url, ref_id, listed_at, first_seen, removed_at
		 FROM oz_entries WHERE key = ANY($1::text[]) ORDER BY removed_at NULLS FIRST, source`,
		[keys]
	);
	const received = await sql.query(
		`SELECT txid, action, relation, height, ts, from_address, from_chain, amount, usd, hop, risk, origin_key, origin_source, origin_entity, reason
		 FROM oz_trace_edges WHERE to_key = ANY($1::text[]) ORDER BY hop, ts LIMIT 100`,
		[keys]
	);
	const sent = await sql.query(
		`SELECT txid, action, relation, height, ts, to_address, to_chain, amount, usd, hop, risk, reason
		 FROM oz_trace_edges WHERE from_key = ANY($1::text[]) ORDER BY ts LIMIT 100`,
		[keys]
	);
	return json(
		{
			address,
			keys,
			verdict: res.results[0],
			snapshot: res.snapshot,
			listings: entries.rows,
			flowsReceived: received.rows,
			flowsSentWhileFlagged: sent.rows
		},
		{ headers }
	);
};
