/**
 * Engine jobs as the app can run them. In production the OZONE-WORKER runs
 * them on a schedule; the app's cron endpoints only run them when
 * OZONE_SYNC_IN_APP=1 (e.g. a deployment without the worker), so the two
 * never fight over the same tables.
 */
import { env } from '$env/dynamic/private';
import {
	consoleLogger,
	publishSnapshot,
	screenUsersFromLatest,
	sourceById,
	syncAllSources,
	syncSource,
	type SyncOutcome
} from '$engine/index.js';
import { snapshotSigningKey } from './keys';
import { sql } from './sql';

export const syncInApp = () => env.OZONE_SYNC_IN_APP === '1';

export async function runSources(ids?: string[]): Promise<SyncOutcome[]> {
	if (ids?.length === 1) {
		const def = sourceById(ids[0]);
		if (!def) throw new Error(`Unknown source ${ids[0]}`);
		return [await syncSource(sql, def, { logger: consoleLogger })];
	}
	return syncAllSources(sql, { logger: consoleLogger }, ids);
}

/** Publishes a signed snapshot when this deployment holds the snapshot key. */
export async function runPublish() {
	const key = snapshotSigningKey();
	if (!key) return { skipped: 'no OZONE_SNAPSHOT_SIGNING_KEY in this deployment (the worker publishes)' };
	const s = await publishSnapshot(sql, key);
	if (!s.published) return { published: false, reason: s.reason };
	return { version: s.version, size: s.size, stats: s.stats };
}

export async function runUserScreening() {
	return (await screenUsersFromLatest(sql)) ?? { skipped: 'no snapshot yet' };
}
