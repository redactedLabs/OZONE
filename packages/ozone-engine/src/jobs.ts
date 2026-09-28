/**
 * High-level jobs used by the worker (scheduled) and the app (admin
 * triggers, local runs). Each job is idempotent and safe to re-run.
 */
import { decodePayload, type PrivateKeyInfo, type SnapshotIndex } from '../../ozone-client/src/index.js';
import { runClusterExpansion, type ClusterRunResult } from './cluster/run.js';
import type { ExplorerEnv } from './explorers/evm.js';
import { buildAndStoreSnapshot, latestSnapshot, snapshotPayload, type PublishResult, type StoreOptions } from './snapshot/builder.js';
import { activeSources, SOURCES, type SourceContext, type SourceDef } from './sources/registry.js';
import { applySourceResult, recordSourceError, type ApplyStats } from './store/entries.js';
import { screenUsers, type UserScreenResult } from './screen/users.js';
import { loadTraceIndex, setState } from './store/trace.js';
import { runTraceBackfill, type BackfillResult } from './trace/jobs.js';
import type { MidgardLike } from './trace/midgard.js';
import type { PriceOracle } from './trace/prices.js';
import type { Logger, Sql } from './types.js';

export interface SyncOutcome {
	source: string;
	ok: boolean;
	stats?: ApplyStats;
	error?: string;
	durationMs: number;
}

export async function syncSource(sql: Sql, def: SourceDef, ctx: SourceContext = {}): Promise<SyncOutcome> {
	const t0 = Date.now();
	try {
		const res = await def.fetchParse({ ...ctx, sql });
		const stats = await applySourceResult(sql, def, res);
		ctx.logger?.info(`source ${def.id}: ${stats.active} active (+${stats.inserted} new, ${stats.removed} delisted, ${stats.rejected} rejected)`);
		await logSync(sql, def.id, 'success', stats.active, stats.removed, Date.now() - t0);
		return { source: def.id, ok: true, stats, durationMs: Date.now() - t0 };
	} catch (e) {
		const error = (e as Error).message ?? String(e);
		await recordSourceError(sql, def, error).catch(() => undefined);
		await logSync(sql, def.id, 'error', 0, 0, Date.now() - t0, error).catch(() => undefined);
		ctx.logger?.warn(`source ${def.id} failed: ${error}`);
		return { source: def.id, ok: false, error, durationMs: Date.now() - t0 };
	}
}

export async function syncAllSources(sql: Sql, ctx: SourceContext = {}, only?: string[]): Promise<SyncOutcome[]> {
	const out: SyncOutcome[] = [];
	for (const def of activeSources()) {
		if (only && !only.includes(def.id)) continue;
		out.push(await syncSource(sql, def, ctx));
	}
	return out;
}

/** Keeps the existing `sync_log` table (admin pages) informed. */
async function logSync(sql: Sql, type: string, status: string, records: number, flags: number, duration: number, error?: string) {
	await sql.query(
		`INSERT INTO sync_log (type, status, records_processed, flags_found, duration, error) VALUES ($1,$2,$3,$4,$5,$6)`,
		[`OZ:${type}`.slice(0, 64), status, records, flags, duration, error?.slice(0, 1000) ?? null]
	);
}

/** Hack-cluster expansion (one cluster per incident and chain): see cluster/run.ts. */
export { runClusterExpansion, CLUSTER_SOURCE, CLUSTER_PERIOD_MS, clusterSourceResult, type ClusterRunResult, type ClusterRunSummary, type ClusterRunOptions } from './cluster/run.js';

export async function publishSnapshot(sql: Sql, key: PrivateKeyInfo, opts: StoreOptions = {}): Promise<PublishResult> {
	return buildAndStoreSnapshot(sql, key, opts);
}

/** The newest stored snapshot as a verified index (verification against the given keys). */
export async function loadLatestIndex(sql: Sql): Promise<SnapshotIndex | undefined> {
	const latest = await latestSnapshot(sql);
	if (!latest) return undefined;
	const payload = await snapshotPayload(sql, latest.version);
	if (!payload) return undefined;
	return decodePayload(latest.manifest, payload);
}

export async function screenUsersFromLatest(sql: Sql, opts: { flagAt?: 'high' | 'severe' | 'medium' } = {}): Promise<UserScreenResult | undefined> {
	const index = await loadLatestIndex(sql);
	if (!index) return undefined;
	const t0 = Date.now();
	const r = await screenUsers(sql, index, opts);
	await logSync(sql, 'users', 'success', r.accounts, r.flagged, Date.now() - t0);
	await setState(sql, 'users:last', { ...r, at: new Date().toISOString(), snapshot: index.version });
	return r;
}

export interface IncidentResult {
	/** The maintainer-flag sync (lists the pasted addresses). */
	sync: SyncOutcome;
	/** On-chain expansion of the pasted incidents (urgent maintainer incidents with a name). */
	expansion?: ClusterRunResult;
	/** Keys on the incident path (urgent flags and what was traced from them). */
	urgentKeys: number;
	/** Tracing of those keys (Midgard history, hop by hop within the budget). */
	trace?: BackfillResult;
}

/**
 * The incident path ("a hack was announced: list these addresses now"):
 * syncs the maintainer flags immediately instead of at the next scheduled
 * sync, then reads the THORChain history of every urgent key — and of every
 * recipient traced from one, hop after hop — before anything else, within
 * `timeBudgetMs`. The caller publishes a snapshot right after (the worker
 * serializes that with its own snapshot job), so the addresses and their
 * THORChain recipients reach nodes within minutes.
 */
export async function runIncidentPath(
	sql: Sql,
	midgard: MidgardLike,
	opts: {
		prices?: PriceOracle;
		logger?: Logger;
		timeBudgetMs?: number;
		http?: SourceContext['http'];
		/**
		 * Expand the pasted incidents on their own chains before tracing (their
		 * members are then traced first too); false = skip. Small by default:
		 * the weekly expansion continues where this stops.
		 */
		expansion?: false | { maxRequests?: number; timeBudgetMs?: number; env?: ExplorerEnv };
	} = {}
): Promise<IncidentResult> {
	const manual = SOURCES.find((d) => d.id === 'manual');
	if (!manual) throw new Error('manual source missing');
	const sync = await syncSource(sql, manual, { sql, logger: opts.logger, http: opts.http });
	if (!sync.ok) return { sync, urgentKeys: 0 };
	let expansion: ClusterRunResult | undefined;
	if (opts.expansion !== false) {
		expansion = await runClusterExpansion(sql, {
			logger: opts.logger,
			http: opts.http,
			env: opts.expansion?.env,
			maxRequests: opts.expansion?.maxRequests ?? 300,
			timeBudgetMs: opts.expansion?.timeBudgetMs ?? 3 * 60_000,
			only: (s) => s.incident.startsWith('manual:') && !!s.urgent
		});
		const ran = expansion.runs.filter((r) => r.status !== 'skipped');
		if (ran.length) opts.logger?.info(`incident path: expanded ${ran.map((r) => `${r.cluster} (${r.members} members, ${r.status})`).join(', ')}`);
	}
	const index = await loadTraceIndex(sql);
	const urgentKeys = [...index.values()].filter((e) => e.urgent).length;
	if (!urgentKeys) return { sync, urgentKeys, ...(expansion ? { expansion } : {}) };
	const trace = await runTraceBackfill(sql, midgard, {
		prices: opts.prices,
		logger: opts.logger,
		timeBudgetMs: opts.timeBudgetMs ?? 5 * 60_000,
		concurrency: 2,
		filter: (_key, e) => !!e.urgent
	});
	opts.logger?.info(`incident path: ${urgentKeys} urgent key(s); ${trace.checked} checked, ${trace.traced} traced, ${trace.remaining} left`);
	return { sync, urgentKeys, trace, ...(expansion ? { expansion } : {}) };
}
