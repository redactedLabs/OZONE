/**
 * The verdict behind GET /api/health (what an uptime monitor watches): ok,
 * or not ok with the reasons, from the state the worker leaves in the
 * database. Pure, so the thresholds are tested without a database.
 *
 * Not ok when:
 * - there is no signed snapshot, or a core source has never synced (no
 *   "clean" answer may rest on a gap);
 * - the real-time follower has not moved its cursor for 15 minutes (the
 *   worker's own watchdog restarts it after the same time);
 * - a core source has not synced successfully for 24 hours (their periods
 *   are 12 hours or shorter);
 * - every Midgard request has failed for an hour (the worker's daily budget
 *   counters; only while the worker keeps them fresh);
 * - the newest snapshot is older than its schedule: unchanged content is
 *   republished every 6 hours, so an older one means publishing stopped.
 *
 * A non-core source that fails is a warning: visible, but not a stall.
 */
export const HEALTH_LIMITS = {
	realtimeStaleMs: 15 * 60_000,
	coreSourceStaleMs: 24 * 3600_000,
	midgardFailingMs: 3600_000,
	/** Unchanged snapshots are republished every 6 h (StoreOptions.republishAfterMs); 30 min for the 10-min job to get there. */
	snapshotMaxAgeMs: 6.5 * 3600_000,
	/** Midgard counters older than this are not the worker's current state (it writes them every minute). */
	midgardStateFreshMs: 10 * 60_000
} as const;

export interface HealthInputs {
	now: number;
	snapshot: { builtAt: string } | null;
	/** `oz_state` `trace:realtime` (updated on every completed tick). */
	realtime: { updatedAt: string } | null;
	sources: Array<{ id: string; lastSuccessAt: string | null; lastError?: string | null }>;
	coreSources: readonly string[];
	/** `oz_state` `midgard:usage` (worker), with the row's update time. */
	midgard?: { lastSuccessAt?: string; failingSince?: string; updatedAt: string } | null;
}

export interface HealthVerdict {
	ok: boolean;
	/** Why not ok (empty when ok). */
	reasons: string[];
	/** Visible problems that are not a stall. */
	warnings: string[];
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;
const hours = (ms: number) => `${(ms / 3600_000).toFixed(1)} h`;

export function healthVerdict(i: HealthInputs, limits = HEALTH_LIMITS): HealthVerdict {
	const reasons: string[] = [];
	const warnings: string[] = [];
	const age = (iso: string | null | undefined) => (iso ? i.now - Date.parse(iso) : Infinity);

	if (!i.snapshot) reasons.push('no signed snapshot has been published yet');
	else if (age(i.snapshot.builtAt) > limits.snapshotMaxAgeMs) {
		reasons.push(`the newest snapshot is ${hours(age(i.snapshot.builtAt))} old (republished at least every 6 h): publishing has stopped`);
	}

	if (!i.realtime) reasons.push('the real-time follower has never run');
	else if (age(i.realtime.updatedAt) > limits.realtimeStaleMs) {
		reasons.push(`the real-time follower has not moved for ${minutes(age(i.realtime.updatedAt))} (limit ${minutes(limits.realtimeStaleMs)})`);
	}

	const byId = new Map(i.sources.map((s) => [s.id, s]));
	for (const id of i.coreSources) {
		const s = byId.get(id);
		if (!s?.lastSuccessAt) {
			reasons.push(`core source ${id} has never synced`);
			continue;
		}
		const a = age(s.lastSuccessAt);
		if (a > limits.coreSourceStaleMs) {
			reasons.push(`core source ${id} has not synced for ${hours(a)} (limit 24 h)${s.lastError ? `: ${s.lastError.slice(0, 160)}` : ''}`);
		}
	}
	for (const s of i.sources) {
		if (i.coreSources.includes(s.id) || !s.lastError) continue;
		warnings.push(`source ${s.id} is failing${s.lastSuccessAt ? ` (last success ${s.lastSuccessAt})` : ''}: ${s.lastError.slice(0, 160)}`);
	}

	const m = i.midgard;
	if (m && age(m.updatedAt) <= limits.midgardStateFreshMs) {
		const since = m.failingSince ? age(m.failingSince) : 0;
		const quiet = age(m.lastSuccessAt);
		if (m.failingSince && since > limits.midgardFailingMs && quiet > limits.midgardFailingMs) {
			reasons.push(`every Midgard request has failed for ${minutes(Math.min(since, quiet))} (last success ${m.lastSuccessAt ?? 'never'})`);
		}
	}
	return { ok: reasons.length === 0, reasons, warnings };
}
