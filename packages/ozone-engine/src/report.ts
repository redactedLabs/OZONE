/**
 * Coverage numbers — the same queries back the app's /api/stats and the
 * local `ozone stats` report, so the published numbers are reproducible.
 */
import { THORCHAIN_CHAINS } from '../../ozone-client/src/index.js';
import type { Sql } from './types.js';

export interface CoverageReport {
	generatedAt: string;
	listed: {
		/** Distinct addresses (keys) currently listed by at least one source. */
		addresses: number;
		/** … of which on chains THORChain serves. */
		thorchainChains: number;
		bySource: Array<{ source: string; active: number; removed: number; lastSuccessAt: string | null; version: string | null; error: string | null }>;
		byChain: Array<{ chain: string; addresses: number }>;
		byCategory: Array<{ category: string; risk: string; addresses: number }>;
		delisted: number;
	};
	traced: {
		addresses: number;
		flows: number;
		byHop: Array<{ hop: number; risk: string; addresses: number }>;
		byOrigin: Array<{ source: string; addresses: number }>;
		byChain: Array<{ chain: string; addresses: number }>;
		checkedAddresses: number;
		pendingAddresses: number;
		services: number;
	};
	users: {
		accounts: number;
		thorAccounts: number;
		linkedL1: number;
		flagged: number;
		flaggedByRisk: Array<{ risk: string; accounts: number }>;
	};
	snapshot: { version: number; builtAt: string; size: number; keys: number } | null;
}

const num = (v: unknown) => Number(v ?? 0);

export async function coverageReport(sql: Sql): Promise<CoverageReport> {
	const q = async <T>(text: string, params?: unknown[]) => (await sql.query<T>(text, params)).rows;
	const thorChains = [...THORCHAIN_CHAINS];

	const [listedTotal] = await q<{ n: number }>(`SELECT count(DISTINCT key)::int AS n FROM oz_entries WHERE removed_at IS NULL`);
	const [listedThor] = await q<{ n: number }>(
		`SELECT count(DISTINCT key)::int AS n FROM oz_entries WHERE removed_at IS NULL AND (chain = ANY($1::text[]) OR key LIKE 'evm:%')`,
		[thorChains]
	);
	const bySource = await q<{ id: string; active: number; removed: number; last_success_at: string | null; last_version: string | null; last_error: string | null }>(
		`SELECT s.id,
		   (SELECT count(*)::int FROM oz_entries e WHERE e.source = s.id AND e.removed_at IS NULL) AS active,
		   (SELECT count(*)::int FROM oz_entries e WHERE e.source = s.id AND e.removed_at IS NOT NULL) AS removed,
		   s.last_success_at, s.last_version, s.last_error
		 FROM oz_sources s ORDER BY active DESC`
	);
	const byChain = await q<{ chain: string; n: number }>(
		`SELECT chain, count(DISTINCT key)::int AS n FROM oz_entries WHERE removed_at IS NULL GROUP BY chain ORDER BY n DESC`
	);
	const byCategory = await q<{ category: string; risk: string; n: number }>(
		`SELECT category, risk, count(DISTINCT key)::int AS n FROM oz_entries WHERE removed_at IS NULL GROUP BY category, risk ORDER BY n DESC`
	);
	const [delisted] = await q<{ n: number }>(
		`SELECT count(DISTINCT key)::int AS n FROM oz_entries e WHERE removed_at IS NOT NULL
		   AND NOT EXISTS (SELECT 1 FROM oz_entries a WHERE a.key = e.key AND a.removed_at IS NULL)`
	);

	const [tracedTotal] = await q<{ n: number }>(
		`SELECT count(*)::int AS n FROM oz_traced t WHERE NOT suppressed AND NOT EXISTS (SELECT 1 FROM oz_entries e WHERE e.key = t.key AND e.removed_at IS NULL)`
	);
	const [flows] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM oz_trace_edges`);
	const byHop = await q<{ hop: number; risk: string; n: number }>(
		`SELECT hop, risk, count(*)::int AS n FROM oz_traced WHERE NOT suppressed GROUP BY hop, risk ORDER BY hop, n DESC`
	);
	const byOrigin = await q<{ source: string; n: number }>(
		`SELECT origin_source AS source, count(*)::int AS n FROM oz_traced WHERE NOT suppressed GROUP BY origin_source ORDER BY n DESC`
	);
	const tracedByChain = await q<{ chain: string; n: number }>(
		`SELECT chain, count(*)::int AS n FROM oz_traced WHERE NOT suppressed GROUP BY chain ORDER BY n DESC`
	);
	const [checked] = await q<{ done: number; pending: number; services: number }>(
		`SELECT count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status IN ('pending','error'))::int AS pending,
		        count(*) FILTER (WHERE status = 'service')::int AS services FROM oz_trace_checked`
	);

	const [users] = await q<{ accounts: number; thor: number; flagged: number }>(
		`SELECT count(*)::int AS accounts, count(*) FILTER (WHERE thor_address LIKE 'thor1%')::int AS thor,
		        count(*) FILTER (WHERE flagged)::int AS flagged FROM rujira_users`
	);
	const [linked] = await q<{ n: number }>(`SELECT count(DISTINCT l1_address)::int AS n FROM l1_addresses WHERE affiliate IS NOT TRUE`);
	const flaggedByRisk = await q<{ risk: string; n: number }>(
		`SELECT coalesce(risk, 'unknown') AS risk, count(*)::int AS n FROM rujira_users WHERE flagged GROUP BY 1 ORDER BY n DESC`
	);

	const [snap] = await q<{ version: string; built_at: string; size: number; stats: { keys?: number } | string | null }>(
		`SELECT version, built_at, size, stats FROM oz_snapshots ORDER BY version DESC LIMIT 1`
	);
	const snapStats = snap ? (typeof snap.stats === 'string' ? JSON.parse(snap.stats) : snap.stats) : null;

	return {
		generatedAt: new Date().toISOString(),
		listed: {
			addresses: num(listedTotal?.n),
			thorchainChains: num(listedThor?.n),
			bySource: bySource.map((r) => ({
				source: r.id,
				active: num(r.active),
				removed: num(r.removed),
				lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).toISOString() : null,
				version: r.last_version,
				error: r.last_error
			})),
			byChain: byChain.map((r) => ({ chain: r.chain, addresses: num(r.n) })),
			byCategory: byCategory.map((r) => ({ category: r.category, risk: r.risk, addresses: num(r.n) })),
			delisted: num(delisted?.n)
		},
		traced: {
			addresses: num(tracedTotal?.n),
			flows: num(flows?.n),
			byHop: byHop.map((r) => ({ hop: num(r.hop), risk: r.risk, addresses: num(r.n) })),
			byOrigin: byOrigin.map((r) => ({ source: r.source, addresses: num(r.n) })),
			byChain: tracedByChain.map((r) => ({ chain: r.chain, addresses: num(r.n) })),
			checkedAddresses: num(checked?.done),
			pendingAddresses: num(checked?.pending),
			services: num(checked?.services)
		},
		users: {
			accounts: num(users?.accounts),
			thorAccounts: num(users?.thor),
			linkedL1: num(linked?.n),
			flagged: num(users?.flagged),
			flaggedByRisk: flaggedByRisk.map((r) => ({ risk: r.risk, accounts: num(r.n) }))
		},
		snapshot: snap
			? { version: Number(snap.version), builtAt: new Date(snap.built_at).toISOString(), size: num(snap.size), keys: num(snapStats?.keys) }
			: null
	};
}
