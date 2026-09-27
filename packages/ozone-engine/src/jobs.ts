/**
 * High-level jobs used by the worker (scheduled) and the app (admin
 * triggers, local runs). Each job is idempotent and safe to re-run.
 */
import { decodePayload, type PrivateKeyInfo, type SnapshotIndex } from '../../ozone-client/src/index.js';
import { clusterEntries, expandCluster } from './evm/expand.js';
import { buildAndStoreSnapshot, latestSnapshot, snapshotPayload, type StoredSnapshot } from './snapshot/builder.js';
import { CURATED, type ClusterSpec } from './sources/curated-data.js';
import { SOURCES, type SourceContext, type SourceDef } from './sources/registry.js';
import { applySourceResult, recordSourceError, type ApplyStats } from './store/entries.js';
import { screenUsers, type UserScreenResult } from './screen/users.js';
import { setState } from './store/trace.js';
import type { Sql } from './types.js';

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
	for (const def of SOURCES) {
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

export const CLUSTER_SOURCE = {
	id: 'cluster',
	name: 'Hack cluster expansion (Ethereum)',
	kind: 'derived',
	url: 'https://ozone.redacted.gg/methodology#clusters',
	maxDropRatio: 0.5
};

async function clusterSeeds(sql: Sql, spec: ClusterSpec): Promise<string[]> {
	const r = await sql.query<{ address: string; source: string; entity: string | null }>(
		`SELECT address, source, entity FROM oz_entries WHERE removed_at IS NULL AND key LIKE 'evm:%' AND source = ANY($1::text[])`,
		[spec.seedSources]
	);
	return r.rows
		.filter((row) => row.source !== 'ethlabels' || !spec.seedLabelFilter || (row.entity ?? '').includes(spec.seedLabelFilter))
		.map((row) => row.address);
}

export async function runClusterExpansion(
	sql: Sql,
	ctx: SourceContext & { maxRequests?: number } = {},
	specs: ClusterSpec[] = CURATED.clusters
): Promise<SyncOutcome> {
	const t0 = Date.now();
	try {
		const merged = { entries: [] as ReturnType<typeof clusterEntries>['entries'], rejected: [], notes: [] as string[], version: '' };
		const versions: string[] = [];
		for (const spec of specs) {
			const seeds = await clusterSeeds(sql, spec);
			if (!seeds.length) throw new Error(`cluster ${spec.id}: no seeds (sync ${spec.seedSources.join(', ')} first)`);
			const result = await expandCluster(spec, seeds, { http: ctx.http, logger: ctx.logger, maxRequests: ctx.maxRequests });
			const res = clusterEntries(spec, result);
			merged.entries.push(...res.entries);
			merged.notes.push(...res.notes);
			versions.push(res.version ?? spec.id);
		}
		merged.version = versions.join(',');
		const stats = await applySourceResult(sql, CLUSTER_SOURCE, merged);
		await logSync(sql, 'cluster', 'success', stats.active, 0, Date.now() - t0);
		return { source: 'cluster', ok: true, stats, durationMs: Date.now() - t0 };
	} catch (e) {
		const error = (e as Error).message;
		await recordSourceError(sql, CLUSTER_SOURCE, error).catch(() => undefined);
		return { source: 'cluster', ok: false, error, durationMs: Date.now() - t0 };
	}
}

export async function publishSnapshot(
	sql: Sql,
	key: PrivateKeyInfo,
	opts: { now?: Date; keep?: number; partSize?: number; republishAfterMs?: number } = {}
): Promise<StoredSnapshot> {
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
