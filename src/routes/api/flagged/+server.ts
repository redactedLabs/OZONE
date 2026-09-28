/**
 * GET /api/flagged — Ozone's flagged numbers, each with its list.
 *
 *   /api/flagged                 both counters (+ breakdown) and the monitored-accounts list
 *   /api/flagged?list=all        (1) every flagged address, all chains (risk ≥ high)
 *   /api/flagged?list=thor       (2) the flagged THORChain (thor1) addresses among them
 *   /api/flagged?list=users      monitored thor1 accounts that are flagged (own address or linked L1)
 *
 * Lists 1 and 2 come from the newest signed snapshot and show only what it
 * publishes (address, chain, risk, reason codes, sources, incident); page
 * with `offset` and `limit` (≤ 1000), filter with `q`, `source`, `chain`;
 * `format=csv` downloads the whole (filtered) list.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from '$lib/server/ozone/sql';
import { coverage } from '$lib/server/ozone/stats';
import { currentSnapshot } from '$lib/server/ozone/snapshot';
import { DEFINITIONS, LISTS, flaggedCsv, flaggedMatches, flaggedPage, flaggedSummary, parseListName, summaryMeta } from '$lib/server/ozone/flagged';

interface Row {
	thor_address: string;
	flag_reason: string | null;
	risk: string | null;
	flag_detail: Array<{ via: string; code: string; source: string; risk: string; text: string }> | null;
	screened_at: string | null;
}

async function monitoredFlagged() {
	const rows = (
		await sql.query<Row>(
			`SELECT thor_address, flag_reason, risk, flag_detail, screened_at FROM rujira_users WHERE flagged AND thor_address LIKE 'thor1%' ORDER BY thor_address`
		)
	).rows;
	return rows.map((u) => ({
		thorAddress: u.thor_address,
		risk: u.risk,
		flagReason: u.flag_reason,
		reasons: u.flag_detail ?? [],
		flaggedAt: u.screened_at ? new Date(u.screened_at).toISOString() : null
	}));
}

const csvResponse = (body: string, name: string) =>
	new Response(body, {
		headers: {
			'Content-Type': 'text/csv',
			'Content-Disposition': `attachment; filename="ozone-${name}-${new Date().toISOString().split('T')[0]}.csv"`
		}
	});

let csvCache: { id: string; body: string } | undefined;

export const GET: RequestHandler = async ({ url }) => {
	const format = url.searchParams.get('format') || 'json';
	const listParam = url.searchParams.get('list');
	const list = parseListName(listParam);

	if (list) {
		const snap = await currentSnapshot();
		if (!snap) return json({ error: 'no snapshot yet' }, { status: 503 });
		const summary = flaggedSummary(snap.index);
		const query = {
			list,
			q: url.searchParams.get('q') ?? undefined,
			source: url.searchParams.get('source') ?? undefined,
			chain: url.searchParams.get('chain') ?? undefined
		};
		if (format === 'csv') {
			const id = `${summary.snapshot.version}:${summary.snapshot.sha256}:${JSON.stringify(query)}`;
			if (csvCache?.id !== id) csvCache = { id, body: flaggedCsv(flaggedMatches(summary, query)) };
			return csvResponse(csvCache.body, list === 'thor' ? 'flagged-thorchain-addresses' : 'flagged-addresses');
		}
		const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
		const limit = Number(url.searchParams.get('limit') ?? 100) || 100;
		const page = flaggedPage(summary, { ...query, offset, limit });
		return json({
			meta: {
				generated: new Date().toISOString(),
				list,
				definition: list === 'thor' ? DEFINITIONS.flaggedThorAddresses : DEFINITIONS.flaggedAddresses,
				snapshot: { ...summary.snapshot, signed: snap.signed },
				total: page.total,
				offset: Math.max(0, Math.floor(offset)),
				limit: Math.max(1, Math.min(1000, Math.floor(limit))),
				...summaryMeta(summary)
			},
			addresses: page.rows
		});
	}
	if (listParam && listParam !== 'users') return json({ error: 'list must be all, thor or users' }, { status: 400 });

	const users = await monitoredFlagged();
	if (format === 'csv') {
		const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
		const lines = ['thor_address,risk,flag_reason,flagged_at'];
		for (const f of users) lines.push([q(f.thorAddress), q(f.risk ?? ''), q(f.flagReason ?? ''), q(f.flaggedAt ?? '')].join(','));
		return csvResponse(lines.join('\n'), 'flagged-monitored-thorchain-accounts');
	}

	const [c, snap] = await Promise.all([coverage(), currentSnapshot().catch(() => undefined)]);
	const summary = snap ? flaggedSummary(snap.index) : undefined;
	return json({
		meta: {
			generated: new Date().toISOString(),
			snapshot: summary ? { ...summary.snapshot, signed: snap!.signed } : null,
			counts: {
				flaggedAddresses: summary?.counts.flaggedAddresses ?? null,
				flaggedThorAddresses: summary?.counts.flaggedThorAddresses ?? null,
				monitoredThorAccountsFlagged: users.length
			},
			breakdown: summary ? summaryMeta(summary).breakdown : null,
			lists: LISTS,
			definitions: DEFINITIONS,
			listedAddresses: c.listed.addresses,
			tracedAddresses: c.traced.addresses,
			sources: c.listed.bySource.map((s) => s.source),
			// kept for existing consumers: the monitored-accounts count and list, as before
			totalFlagged: users.length,
			flaggedThorUsers: users.length,
			deprecated: 'totalFlagged, flaggedThorUsers and the flaggedAddresses array are the monitored-accounts list (counts.monitoredThorAccountsFlagged, lists.monitoredThorAccountsFlagged), kept for compatibility.'
		},
		monitoredThorAccountsFlagged: users,
		flaggedAddresses: users
	});
};
