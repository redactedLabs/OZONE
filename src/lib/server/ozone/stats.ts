/**
 * Dashboard numbers with one meaning each:
 * - listed addresses: distinct addresses currently on at least one list;
 * - traced addresses: flagged because they received value from a listed
 *   address through THORChain (not listed themselves);
 * - flagged THORChain users: monitored thor1 accounts whose own address or
 *   linked L1 address is flagged (risk ≥ high);
 * - monitored accounts: thor1 accounts Ozone watches (the old "total users"
 *   also counted L1 addresses picked up from action scans).
 */
import { coverageReport, type CoverageReport } from '$engine/index.js';
import { sql } from './sql';

let cache: { at: number; report: CoverageReport } | undefined;

export async function coverage(maxAgeMs = 60_000): Promise<CoverageReport> {
	if (cache && Date.now() - cache.at < maxAgeMs) return cache.report;
	const report = await coverageReport(sql);
	cache = { at: Date.now(), report };
	return report;
}

export async function dailyDeltas() {
	const r = await sql.query<{ users: number; listed: number; traced: number }>(
		`SELECT
		   (SELECT count(*)::int FROM rujira_users WHERE thor_address LIKE 'thor1%' AND first_seen > now() - interval '24 hours') AS users,
		   (SELECT count(DISTINCT key)::int FROM oz_entries WHERE removed_at IS NULL AND first_seen > now() - interval '24 hours') AS listed,
		   (SELECT count(*)::int FROM oz_traced WHERE NOT suppressed AND updated_at > now() - interval '24 hours') AS traced`
	);
	return r.rows[0] ?? { users: 0, listed: 0, traced: 0 };
}
