/**
 * Per-incident evaluation on public data (local PGlite, never a remote
 * database): are each incident's THORChain-side outputs flagged?
 *
 *   npx tsx packages/ozone-engine/scripts/incidents-eval.ts [--budget N] [--per-cluster N] [--trace-minutes M] [--out file.json]
 *
 * 1. lists every curated incident (and the FBI and eth-labels seeds of the
 *    Bybit cluster);
 * 2. expands every incident's cluster within a small request budget
 *    (THORChain-laundered incidents first; keyless explorers, rate-limited);
 * 3. reads the THORChain history of every incident address and cluster
 *    member through Midgard and traces what it sent (hops, thresholds as in
 *    production);
 * 4. publishes a local snapshot (dev key) and screens the pass-D test set;
 * 5. prints per incident: listed, cluster members, THORChain actions of the
 *    listed addresses, traced addresses (the flagged THORChain-side outputs).
 *
 * Environment: OZONE_LOCAL_DB (default .ozone-local/eval-pgdata), MIDGARD_URL,
 * optional ETHERSCAN_API_KEY / BLOCKSCOUT_API_KEY.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateSigningKey, loadPrivateKey } from '../../ozone-client/src/index.js';
import {
	applySourceResult,
	consoleLogger,
	CURATED,
	curatedClusterSpecs,
	loadLatestIndex,
	Midgard,
	migrate,
	parseCurated,
	publishSnapshot,
	runClusterExpansion,
	runTraceBackfill,
	sourceById,
	syncSource,
	type Sql
} from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : dflt;
};

/** The pass-D test set (addresses from public reports; see the pass-D report). */
const PASS_D_TEST_SET: Array<{ incident: string; address: string; chain: string; side: string }> = [
	{ incident: 'Bybit 2025-02 (Exploiter 65 label)', address: '0xb21e59b3d4e4d6c5247325dc5fbedbc89afc69f4', chain: 'ETH', side: 'source' },
	{ incident: 'Bybit 2025-02 → THORChain output', address: '19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE', chain: 'BTC', side: 'THORChain output' },
	{ incident: 'Stake.com 2023-09', address: '0xa4694f58A2445c5BF89405bc20E87fe6D8622356', chain: 'ETH', side: 'source' },
	{ incident: 'Stake.com 2023-09 → THORChain output', address: 'bc1q6z6y8e335wd3ys5zr0qvqpgztw359w0e9zlpgm', chain: 'BTC', side: 'THORChain output' },
	{ incident: 'CoinEx 2023-09 → THORChain output', address: 'bc1qy06xsq9yx93d02n95mv5y09z8fzy6usrj09ndy', chain: 'BTC', side: 'THORChain output' },
	{ incident: 'CoinEx 2023-09 → THORChain output', address: 'bc1qzed4cka5972m3x5uh254msyn3f7sfqvcdkhv2k', chain: 'BTC', side: 'THORChain output' },
	{ incident: 'Coinbase-phishing 2025-05 (THORChain output ETH)', address: '0xc84c35f57caeeb5da8e31d1144c293ae5851ab84', chain: 'ETH', side: 'THORChain output' },
	{ incident: 'Kraken-user theft 2026-03', address: '0xC55149BbD560435a9FbEabFdcF9711cf928acA21', chain: 'ETH', side: 'source' },
	{ incident: 'Kraken-user theft 2026-03 → THORChain output', address: '1D8f8956EEFLXN28AHfioEx4ywVbxCz8KN', chain: 'BTC', side: 'THORChain output' },
	{ incident: '$282M hardware-wallet theft 2026-01', address: 'bc1qpsmh26ja0fzzf286zulmt9eywujc2pggj40wzm', chain: 'BTC', side: 'source' },
	{ incident: '$282M hardware-wallet theft 2026-01 → THORChain output', address: 'rBun9Lewb5dmuwkdvhUxQmCUgU3eP45AgG', chain: 'XRP', side: 'THORChain output' },
	{ incident: 'WazirX 2024-07 (Exploiter label)', address: '0x04b21735e93fa3f8df70e2da89e6922616891a88', chain: 'ETH', side: 'source' }
];

async function main() {
	const dataDir = resolve(process.env.OZONE_LOCAL_DB ?? '.ozone-local/eval-pgdata');
	mkdirSync(dataDir, { recursive: true });
	const db = await PGlite.create(dataDir);
	const sql = db as unknown as Sql;
	await migrate(sql, { baseline: true });
	const t0 = Date.now();
	const log = consoleLogger;

	// 1. lists: the incidents, and the Bybit cluster's seed sources
	await applySourceResult(sql, sourceById('curated')!, parseCurated());
	for (const id of ['fbi', 'ethlabels']) {
		const r = await syncSource(sql, sourceById(id)!, { logger: log });
		log.info(`source ${id}: ${r.ok ? r.stats?.active : r.error}`);
	}

	// 2. clusters: a small budget per cluster (the production budgets are larger)
	const perCluster = Number(flag('per-cluster', '120'));
	const specs = curatedClusterSpecs().map((s) => (s.id === 'bybit-2025' ? { ...s, maxRequests: Number(flag('bybit-requests', '200')), maxDepth: 2 } : { ...s, maxRequests: Math.min(s.maxRequests, perCluster), maxDepth: Math.min(s.maxDepth, 2) }));
	const cl = await runClusterExpansion(sql, {
		specs,
		logger: log,
		maxRequests: Number(flag('budget', '3000')),
		timeBudgetMs: Number(flag('cluster-minutes', '45')) * 60_000
	});
	log.info(`clusters: ${cl.ok ? cl.stats?.active : cl.error} members; ${cl.runs.filter((r) => r.status === 'partial').length} cut short`);

	// 3. THORChain tracing of the incident addresses and cluster members (and what they reach)
	const midgard = new Midgard({ baseUrl: process.env.MIDGARD_URL, minIntervalMs: 350, concurrency: 2 });
	const seeds = new Set(
		(await sql.query<{ key: string }>(`SELECT key FROM oz_entries WHERE removed_at IS NULL AND source IN ('curated', 'cluster')`)).rows.map((r) => r.key)
	);
	const trace = await runTraceBackfill(sql, midgard, {
		logger: log,
		timeBudgetMs: Number(flag('trace-minutes', '40')) * 60_000,
		concurrency: 2,
		filter: (key, e) => seeds.has(key) || seeds.has(e.originKey)
	});
	log.info(`trace: ${JSON.stringify(trace)} (Midgard requests ${midgard.requests})`);

	// 4. snapshot + test set
	const key = loadPrivateKey(generateSigningKey().seedHex);
	await publishSnapshot(sql, key, { coreSources: [] });
	const index = (await loadLatestIndex(sql))!;
	const testSet = PASS_D_TEST_SET.map((c) => {
		const v = index.screen(c.address, c.chain);
		return { ...c, status: v.status, risk: v.risk, reason: v.reasons[0]?.text?.slice(0, 140) ?? null, source: v.reasons[0]?.source ?? null };
	});

	// 5. per incident
	const rows: Array<Record<string, unknown>> = [];
	for (const inc of CURATED.incidents) {
		const keys = new Set(
			(await sql.query<{ key: string }>(`SELECT key FROM oz_entries WHERE source = 'curated' AND removed_at IS NULL AND (meta->>'incident' = $1 OR (meta->'alsoIncidents') ? $1)`, [inc.id])).rows.map((r) => r.key)
		);
		const members = new Set((await sql.query<{ key: string }>(`SELECT key FROM oz_cluster_members WHERE incident = $1`, [inc.id])).rows.map((r) => r.key));
		const origins = [...keys, ...members];
		const traced = origins.length
			? (await sql.query<{ n: number; hop1: number; usd: string | null }>(
					`SELECT count(*)::int AS n, count(*) FILTER (WHERE hop = 1)::int AS hop1, sum(usd)::text AS usd FROM oz_traced WHERE origin_key = ANY($1::text[]) AND NOT suppressed`,
					[origins]
				)).rows[0]
			: { n: 0, hop1: 0, usd: null };
		const actions = keys.size
			? (await sql.query<{ n: number }>(`SELECT coalesce(sum(actions), 0)::int AS n FROM oz_trace_checked WHERE key = ANY($1::text[])`, [[...keys]])).rows[0].n
			: 0;
		const runs = (await sql.query<{ cluster: string; complete: boolean; stop: string | null; members: number }>(`SELECT cluster, complete, stop, members FROM oz_cluster_runs WHERE incident = $1`, [inc.id])).rows;
		rows.push({
			incident: inc.name,
			thorchain: inc.thorchain.used,
			listed: keys.size,
			cluster: members.size,
			clusterRuns: runs.map((r) => `${r.cluster.split(':')[1] ?? r.cluster}:${r.complete ? 'complete' : `partial(${r.stop})`}`).join(' '),
			thorchainActions: actions,
			traced: traced.n,
			tracedHop1: traced.hop1,
			tracedUsd: traced.usd ? Math.round(Number(traced.usd)) : 0
		});
	}
	const out = { generatedAt: new Date().toISOString(), minutes: Math.round((Date.now() - t0) / 60_000), clusterRuns: cl.runs, trace, testSet, incidents: rows };
	const file = resolve(flag('out', `${dataDir}/../incidents-eval.json`));
	writeFileSync(file, JSON.stringify(out, null, 1));
	console.table(rows.map((r) => ({ incident: String(r.incident).slice(0, 48), thor: r.thorchain, listed: r.listed, cluster: r.cluster, actions: r.thorchainActions, traced: r.traced })));
	console.table(testSet.map((t) => ({ case: t.incident.slice(0, 50), status: t.status, risk: t.risk, source: t.source })));
	console.log(`written ${file}`);
	await db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
