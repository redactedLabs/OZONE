/**
 * GET /api/health — liveness and data freshness for monitors and nodes.
 * 200 when the database answers and a snapshot exists; 503 otherwise.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from '$lib/server/ozone/sql';
import { publishedKeys, responseKey } from '$lib/server/ozone/keys';
import { CORE_SOURCES } from '$engine/index.js';

export const GET: RequestHandler = async () => {
	const headers = { 'cache-control': 'no-store' };
	const now = Date.now();
	try {
		const snap = await sql.query<{ version: string; built_at: string; stats: unknown }>(
			`SELECT version, built_at, stats FROM oz_snapshots ORDER BY version DESC LIMIT 1`
		);
		const sources = await sql.query<{ id: string; last_success_at: string | null; last_error: string | null; active_count: number }>(
			`SELECT id, last_success_at, last_error, active_count FROM oz_sources ORDER BY id`
		);
		const trace = await sql.query<{ value: { height?: number }; updated_at: string }>(
			`SELECT value, updated_at FROM oz_state WHERE id = 'trace:realtime'`
		);
		const s = snap.rows[0];
		const bySourceId = new Map(sources.rows.map((r) => [r.id, r]));
		// A snapshot existing is not enough: while any core source has never
		// synced, every "clean" verdict it contains could just be a gap.
		const coreReady = CORE_SOURCES.every((id) => !!bySourceId.get(id)?.last_success_at);
		const ok = !!s && coreReady;
		const body = {
			ok,
			time: new Date(now).toISOString(),
			database: 'ok',
			snapshot: s
				? { version: Number(s.version), builtAt: new Date(s.built_at).toISOString(), ageSeconds: Math.round((now - Date.parse(s.built_at)) / 1000) }
				: null,
			realtime: trace.rows[0]
				? { height: trace.rows[0].value?.height ?? null, updatedAt: new Date(trace.rows[0].updated_at).toISOString() }
				: null,
			sources: sources.rows.map((r) => ({
				id: r.id,
				ok: !r.last_error,
				lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).toISOString() : null,
				entries: r.active_count
			})),
			signing: { responses: !!responseKey(), snapshotKeys: publishedKeys().snapshot.map((k) => k.keyId) }
		};
		return json(body, { status: ok ? 200 : 503, headers });
	} catch {
		return json({ ok: false, time: new Date(now).toISOString(), database: 'error' }, { status: 503, headers });
	}
};
