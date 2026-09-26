/**
 * Quality + coverage report against the local engine database (PGlite).
 *
 *   npx tsx packages/ozone-engine/scripts/evaluate.ts [--json]
 *
 * - known-positive / known-negative gates (test/fixtures/known-sets.json)
 *   screened against the newest snapshot;
 * - the Bybit laundering period (2025-02-21 → 2025-03-31) on THORChain:
 *   traced flows, recipients, chains, value;
 * - coverage after (this database) next to coverage before (the live
 *   ozone.redacted.gg numbers observed on 2026-09-27, before this change).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { coverageReport, loadLatestIndex, migrate, type Sql } from '../src/index.js';

const BEFORE = {
	observedAt: '2026-09-27T00:10Z',
	source: 'GET https://ozone.redacted.gg/api/stats, /api/flagged, /banned',
	rows: { OFAC: 1046, EU: 8, HACK: 21, TETHER: 18377, ETH_LABELS: 781, SCAM: 2530, MANUAL: 3, total: 22766 },
	notes: [
		'TETHER rows double-count TRON (stored as lower-case hex by the worker and as base58 by the app) and never drop unfrozen addresses',
		'HACK: 21 rows, 4 verifiable; ETH_LABELS includes stale OFAC/Tornado tags and victim ("compromised") labels',
		'flagged THORChain users: 2 — THORChain affiliate_collector module and an interface affiliate address (false positives)',
		'traced addresses: 0 (no flow tracing); L1→L1 swaps not screened at all'
	],
	flaggedUsers: 2,
	traced: 0
};

async function main() {
	const dataDir = resolve(process.env.OZONE_LOCAL_DB ?? '.ozone-local/pgdata');
	const db = await PGlite.create(dataDir);
	const sql = db as unknown as Sql;
	await migrate(sql, { baseline: true });
	const index = await loadLatestIndex(sql);
	if (!index) throw new Error('no snapshot — run `ozone.ts snapshot` first');

	const known = JSON.parse(readFileSync(new URL('../test/fixtures/known-sets.json', import.meta.url), 'utf8')) as {
		positives: Array<{ address: string; chain: string; why: string }>;
		negatives: Array<{ address: string; chain: string; why: string }>;
	};
	const pos = known.positives.map((p) => {
		const v = index.screen(p.address, p.chain);
		return { ...p, status: v.status, risk: v.risk, top: v.reasons[0]?.text?.slice(0, 110) };
	});
	const neg = known.negatives.map((n) => {
		const v = index.screen(n.address, n.chain);
		return { ...n, status: v.status, risk: v.risk, note: v.reasons[0]?.text?.slice(0, 80) };
	});

	const q = async <T>(text: string, params?: unknown[]) => (await sql.query<T>(text, params)).rows;
	const bybit = await q<{ flows: number; recipients: number; usd: string | null; first: string | null; last: string | null }>(
		`SELECT count(*)::int AS flows, count(DISTINCT to_key)::int AS recipients, sum(usd)::text AS usd, min(ts)::text AS first, max(ts)::text AS last
		 FROM oz_trace_edges WHERE ts >= '2025-02-21' AND ts < '2025-04-01'`
	);
	const bybitByChain = await q<{ chain: string; n: number }>(
		`SELECT to_chain AS chain, count(DISTINCT to_key)::int AS n FROM oz_trace_edges WHERE ts >= '2025-02-21' AND ts < '2025-04-01' GROUP BY 1 ORDER BY 2 DESC`
	);
	const bybitByOrigin = await q<{ source: string; entity: string | null; n: number }>(
		`SELECT origin_source AS source, split_part(coalesce(origin_entity,''), ':', 1) AS entity, count(DISTINCT to_key)::int AS n
		 FROM oz_trace_edges WHERE ts >= '2025-02-21' AND ts < '2025-04-01' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`
	);
	const sample = await q<{ reason: string }>(
		`SELECT reason FROM oz_trace_edges WHERE ts >= '2025-02-21' AND ts < '2025-04-01' AND hop = 1 ORDER BY usd DESC NULLS LAST LIMIT 3`
	);
	const coverage = await coverageReport(sql);
	const report = {
		snapshot: { version: index.version, builtAt: index.builtAt, keys: index.size, sha256: index.sha256 },
		gates: {
			positives: { total: pos.length, flagged: pos.filter((p) => p.status === 'flagged').length, misses: pos.filter((p) => p.status !== 'flagged') },
			negatives: { total: neg.length, clean: neg.filter((n) => n.status === 'clean').length, falsePositives: neg.filter((n) => n.status !== 'clean') }
		},
		bybitPeriod: { ...bybit[0], byChain: bybitByChain, byOrigin: bybitByOrigin, examples: sample.map((s) => s.reason) },
		before: BEFORE,
		after: coverage
	};
	if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
	else {
		console.log('== quality gates');
		console.table(pos.map((p) => ({ address: p.address.slice(0, 18), chain: p.chain, status: p.status, risk: p.risk, why: p.why.slice(0, 60) })));
		console.table(neg.map((n) => ({ address: n.address.slice(0, 18), chain: n.chain, status: n.status, why: n.why.slice(0, 60) })));
		console.log('== Bybit period on THORChain (2025-02-21 → 2025-03-31)');
		console.log(report.bybitPeriod);
		console.log('== coverage after');
		console.log(JSON.stringify({ listed: coverage.listed.addresses, onThorchainChains: coverage.listed.thorchainChains, traced: coverage.traced, users: coverage.users }, null, 1));
		console.table(coverage.listed.bySource.map((s) => ({ source: s.source, active: s.active, history: s.removed, error: s.error?.slice(0, 40) ?? '' })));
		console.table(coverage.listed.byChain.slice(0, 20));
	}
	await db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
