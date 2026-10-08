/**
 * GET /api/health — liveness and data freshness for monitors and nodes.
 *
 * 200 `{ ok: true }` while everything moves; 503 `{ ok: false, reasons }`
 * when Ozone has stalled (engine health.ts): no snapshot or a core source
 * never synced; the real-time follower stale for 15 minutes; a core source
 * stale for 24 hours; every Midgard request failing for an hour; the newest
 * snapshot older than its 6-hour republish schedule. A failing non-core
 * source is listed under `warnings` (and per source) without failing the
 * check. The fields the earlier version returned are unchanged.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from '$lib/server/ozone/sql';
import { publishedKeys, responseKey } from '$lib/server/ozone/keys';
import { CORE_SOURCES, healthVerdict, type QuotaUsage } from '$engine/index.js';

type StateRow<T> = { value: T; updated_at: string };

export const GET: RequestHandler = async () => {
	const headers = { 'cache-control': 'no-store' };
	const now = Date.now();
	const state = async <T>(id: string) =>
		sql
			.query<StateRow<T>>(`SELECT value, updated_at FROM oz_state WHERE id = $1`, [id])
			.then((r) => r.rows[0])
			.catch(() => undefined);
	try {
		const snap = await sql.query<{ version: string; built_at: string; stats: unknown }>(
			`SELECT version, built_at, stats FROM oz_snapshots ORDER BY version DESC LIMIT 1`
		);
		const sources = await sql.query<{ id: string; last_success_at: string | null; last_error: string | null; active_count: number }>(
			`SELECT id, last_success_at, last_error, active_count FROM oz_sources ORDER BY id`
		);
		const trace = await state<{ height?: number }>('trace:realtime');
		// the follower of contract flows (THORNode transaction events); absent until the worker has run it
		const chain = await state<{ height?: number }>('trace:chain');
		// the worker's daily Midgard budget (pass G); absent until a worker with it has run
		const midgard = await state<QuotaUsage>('midgard:usage');
		// the block stream from our own RPC (account discovery)
		const blocks = await state<{ height?: number; mode?: string; source?: string }>('stream:blocks');
		const s = snap.rows[0];
		const iso = (v: string | Date) => new Date(v).toISOString();
		const verdict = healthVerdict({
			now,
			snapshot: s ? { builtAt: iso(s.built_at) } : null,
			realtime: trace ? { updatedAt: iso(trace.updated_at) } : null,
			sources: sources.rows.map((r) => ({ id: r.id, lastSuccessAt: r.last_success_at ? iso(r.last_success_at) : null, lastError: r.last_error })),
			coreSources: CORE_SOURCES,
			midgard: midgard ? { lastSuccessAt: midgard.value?.lastSuccessAt, failingSince: midgard.value?.failingSince, updatedAt: iso(midgard.updated_at) } : null
		});
		const body = {
			ok: verdict.ok,
			...(verdict.reasons.length ? { reasons: verdict.reasons } : {}),
			...(verdict.warnings.length ? { warnings: verdict.warnings } : {}),
			time: new Date(now).toISOString(),
			database: 'ok',
			snapshot: s ? { version: Number(s.version), builtAt: iso(s.built_at), ageSeconds: Math.round((now - Date.parse(s.built_at)) / 1000) } : null,
			realtime: trace ? { height: trace.value?.height ?? null, updatedAt: iso(trace.updated_at) } : null,
			chain: chain ? { height: chain.value?.height ?? null, updatedAt: iso(chain.updated_at) } : null,
			blocks: blocks ? { height: blocks.value?.height ?? null, mode: blocks.value?.mode ?? null, updatedAt: iso(blocks.updated_at) } : null,
			midgard: midgard
				? {
						requestsToday: midgard.value?.requestsToday ?? 0,
						dailyLimit: midgard.value?.dailyLimit ?? null,
						byPriority: midgard.value?.byPriority ?? null,
						rateLimitedToday: midgard.value?.rateLimitedToday ?? 0,
						lastSuccessAt: midgard.value?.lastSuccessAt ?? null,
						last429At: midgard.value?.last429At ?? null,
						failingSince: midgard.value?.failingSince ?? null,
						day: midgard.value?.day ?? null,
						updatedAt: iso(midgard.updated_at)
					}
				: null,
			sources: sources.rows.map((r) => ({
				id: r.id,
				ok: !r.last_error,
				lastSuccessAt: r.last_success_at ? iso(r.last_success_at) : null,
				entries: r.active_count,
				...(r.last_error ? { error: r.last_error.slice(0, 200) } : {})
			})),
			signing: { responses: !!responseKey(), snapshotKeys: publishedKeys().snapshot.map((k) => k.keyId) }
		};
		return json(body, { status: verdict.ok ? 200 : 503, headers });
	} catch {
		return json({ ok: false, reasons: ['the database does not answer'], time: new Date(now).toISOString(), database: 'error' }, { status: 503, headers });
	}
};
