/**
 * The snapshot the API screens against — the same data nodes download, so
 * an online verdict and a node's local verdict agree for the same version.
 *
 * The newest snapshot is read from `oz_snapshots` (built and signed by the
 * worker) and kept in memory; the database is polled for a newer version at
 * most once a minute. Before the first snapshot exists an unsigned one is
 * built from the tables directly (marked `unsigned`).
 */
import { buildSnapshot, decodePayload, verifyManifest, type SnapshotIndex, type SnapshotManifestV1 } from '$ozone/index.js';
import { collectSnapshot, latestSnapshot, snapshotPayload } from '$engine/index.js';
import { publishedKeys } from './keys';
import { sql } from './sql';

export interface CurrentSnapshot {
	index: SnapshotIndex;
	manifest: SnapshotManifestV1;
	signed: boolean;
}

let current: (CurrentSnapshot & { checkedAt: number }) | undefined;
let loading: Promise<CurrentSnapshot | undefined> | undefined;
const RECHECK_MS = 60_000;

async function load(): Promise<CurrentSnapshot | undefined> {
	const latest = await latestSnapshot(sql);
	if (latest) {
		if (current && current.index.version === latest.version) {
			current.checkedAt = Date.now();
			return current;
		}
		const payload = await snapshotPayload(sql, latest.version);
		if (!payload) return current;
		const keys = publishedKeys().snapshot;
		let signed = false;
		if (keys.length) {
			// verify what the worker stored against the keys we publish
			verifyManifest(latest.manifest, keys);
			signed = true;
		}
		const index = decodePayload(latest.manifest, payload);
		current = { index, manifest: latest.manifest, signed, checkedAt: Date.now() };
		return current;
	}
	// No published snapshot yet: build an unsigned one from the tables — but
	// only once the core sanctions list has been ingested. Empty tables must
	// never produce "clean" verdicts; callers get 503 instead.
	const ready = await sql.query<{ n: number }>(
		`SELECT count(*)::int AS n FROM oz_sources WHERE id = 'ofac_sdn' AND last_success_at IS NOT NULL AND active_count > 0`
	);
	if (!ready.rows[0]?.n) return undefined;
	const collected = await collectSnapshot(sql);
	const now = new Date();
	const built = buildSnapshot({
		version: Math.floor(now.getTime() / 1000),
		builtAt: now.toISOString(),
		sources: collected.sources,
		records: collected.records,
		stats: collected.stats
	});
	const index = decodePayload(built.manifest, built.payload);
	current = { index, manifest: built.manifest, signed: false, checkedAt: Date.now() };
	return current;
}

export async function currentSnapshot(): Promise<CurrentSnapshot | undefined> {
	if (current && Date.now() - current.checkedAt < RECHECK_MS) return current;
	loading ??= load()
		.catch((e) => {
			console.error('[ozone] snapshot load failed:', (e as Error).message);
			return current;
		})
		.finally(() => {
			loading = undefined;
		});
	return loading;
}
