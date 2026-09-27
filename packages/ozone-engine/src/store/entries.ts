/**
 * Persists list entries with provenance and computes delistings.
 *
 * Every sync is a complete picture of its source. An address that was
 * active and is missing from a new, *sane* download is marked removed
 * (`removed_at`); one that comes back is reactivated. A download that is
 * too small (below `minEntries`) or drops too much at once (more than
 * `maxDropRatio`) is refused: nothing is changed and the error is recorded
 * — a truncated OFAC file must never mass-delist sanctioned addresses.
 */
import { parseListedAddress } from '../../../ozone-client/src/index.js';
import type { ListEntry, ParseResult, Sql } from '../types.js';
import { batchInsert } from './db.js';

export class SanityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SanityError';
	}
}

export interface SourceMeta {
	id: string;
	name: string;
	kind: string;
	url?: string;
	minEntries?: number;
	maxDropRatio?: number;
}

export interface ApplyStats {
	source: string;
	active: number;
	inserted: number;
	updated: number;
	removed: number;
	reactivated: number;
	rejected: number;
}

/** Shape kept in `oz_sources.state` (unused before this). */
interface SourceState {
	/** Active-count observations, newest last, trimmed to the last 7 days. */
	activeHistory?: Array<{ at: string; active: number }>;
}

const HISTORY_WINDOW_MS = 7 * 24 * 3600_000;

export async function ensureSource(sql: Sql, s: SourceMeta): Promise<void> {
	await sql.query(
		`INSERT INTO oz_sources (id, name, kind, url) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, url = EXCLUDED.url`,
		[s.id, s.name, s.kind, s.url ?? null]
	);
}

export async function recordSourceError(sql: Sql, s: SourceMeta, error: string, now = new Date()): Promise<void> {
	await ensureSource(sql, s);
	await sql.query(`UPDATE oz_sources SET last_attempt_at = $2, last_error = $3 WHERE id = $1`, [s.id, now, error.slice(0, 2000)]);
}

export async function applySourceResult(sql: Sql, s: SourceMeta, res: ParseResult, now = new Date()): Promise<ApplyStats> {
	await ensureSource(sql, s);
	await sql.query(`UPDATE oz_sources SET last_attempt_at = $2 WHERE id = $1`, [s.id, now]);

	// de-duplicate by key (last one wins)
	const byKey = new Map<string, ListEntry>();
	for (const e of res.entries) {
		if (e.source !== s.id) throw new Error(`entry from ${e.source} applied to ${s.id}`);
		byKey.set(e.key, e);
	}
	const entries = [...byKey.values()];
	const newActive = entries.filter((e) => !e.removedAt).length;

	const prev = await sql.query<{ key: string; removed_at: string | null }>(
		`SELECT key, removed_at FROM oz_entries WHERE source = $1`,
		[s.id]
	);
	const prevActive = prev.rows.filter((r) => !r.removed_at).length;
	if (s.minEntries !== undefined && newActive < s.minEntries) {
		throw new SanityError(`${s.id}: only ${newActive} active entries (minimum ${s.minEntries}); sync refused`);
	}

	// The drop-ratio floor is the highest active count seen in the last 7
	// days (kept in oz_sources.state), not just the immediately previous
	// sync: anchoring to only the previous sync lets repeated small drops —
	// each individually under maxDropRatio — ratchet the list down far below
	// its real size, one truncated/forged response at a time.
	const stateRow = await sql.query<{ state: SourceState | string | null }>(`SELECT state FROM oz_sources WHERE id = $1`, [s.id]);
	const rawState = stateRow.rows[0]?.state;
	const state: SourceState = typeof rawState === 'string' ? JSON.parse(rawState) : (rawState ?? {});
	const cutoff = now.getTime() - HISTORY_WINDOW_MS;
	const recentHistory = (state.activeHistory ?? []).filter((h) => Date.parse(h.at) >= cutoff);
	const floor = recentHistory.reduce((m, h) => Math.max(m, h.active), prevActive);

	const maxDrop = s.maxDropRatio ?? 0.25;
	if (floor > 0 && newActive < floor * (1 - maxDrop)) {
		throw new SanityError(
			`${s.id}: active entries would drop from ${floor} (7-day peak) to ${newActive} (> ${Math.round(maxDrop * 100)}%); sync refused`
		);
	}

	const prevMap = new Map(prev.rows.map((r) => [r.key, r.removed_at]));
	let inserted = 0;
	let updated = 0;
	let reactivated = 0;
	for (const e of entries) {
		if (!prevMap.has(e.key)) inserted++;
		else {
			updated++;
			if (prevMap.get(e.key) && !e.removedAt) reactivated++;
		}
	}

	await batchInsert(
		sql,
		`INSERT INTO oz_entries (source, key, chain, address, category, risk, code, entity, reason, ref_url, ref_id, listed_at, first_seen, last_seen, removed_at, meta)`,
		16,
		entries.map((e) => [
			s.id,
			e.key,
			e.chain,
			e.address,
			e.category,
			e.risk,
			e.code,
			e.entity ?? null,
			e.text,
			e.refUrl ?? null,
			e.refId ?? null,
			e.listedAt ? new Date(e.listedAt) : null,
			now,
			now,
			e.removedAt ? new Date(e.removedAt) : null,
			e.meta ? JSON.stringify(e.meta) : null
		]),
		`ON CONFLICT (source, key) DO UPDATE SET
			chain = EXCLUDED.chain, address = EXCLUDED.address, category = EXCLUDED.category, risk = EXCLUDED.risk,
			code = EXCLUDED.code, entity = EXCLUDED.entity, reason = EXCLUDED.reason, ref_url = EXCLUDED.ref_url,
			ref_id = EXCLUDED.ref_id, listed_at = COALESCE(EXCLUDED.listed_at, oz_entries.listed_at),
			last_seen = EXCLUDED.last_seen, removed_at = EXCLUDED.removed_at, meta = EXCLUDED.meta`
	);

	// Delistings: active before, absent now.
	const present = new Set(entries.map((e) => e.key));
	const gone = prev.rows.filter((r) => !r.removed_at && !present.has(r.key)).map((r) => r.key);
	for (let i = 0; i < gone.length; i += 1000) {
		const chunk = gone.slice(i, i + 1000);
		await sql.query(
			`UPDATE oz_entries SET removed_at = $2,
			   meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('removedReason', 'no longer published by the source')
			 WHERE source = $1 AND key = ANY($3::text[]) AND removed_at IS NULL`,
			[s.id, now, chunk]
		);
	}

	const counts = await sql.query<{ active: number; removed: number }>(
		`SELECT count(*) FILTER (WHERE removed_at IS NULL)::int AS active, count(*) FILTER (WHERE removed_at IS NOT NULL)::int AS removed
		 FROM oz_entries WHERE source = $1`,
		[s.id]
	);
	const { active, removed } = counts.rows[0] ?? { active: 0, removed: 0 };
	const newHistory = [...recentHistory, { at: now.toISOString(), active }].slice(-60);
	await sql.query(
		`UPDATE oz_sources SET last_success_at = $2, last_error = NULL, last_version = $3, active_count = $4,
		   removed_count = $5, rejected_count = $6, notes = $7, state = $8 WHERE id = $1`,
		[
			s.id,
			now,
			res.version ?? null,
			active,
			removed,
			res.rejected.length,
			JSON.stringify({ notes: res.notes.slice(0, 50), rejected: res.rejected.slice(0, 50) }),
			JSON.stringify({ activeHistory: newHistory } satisfies SourceState)
		]
	);
	return { source: s.id, active, inserted, updated, removed: gone.length, reactivated, rejected: res.rejected.length };
}

export interface EntryRow {
	source: string;
	key: string;
	chain: string;
	address: string;
	category: string;
	risk: string;
	code: string;
	entity: string | null;
	reason: string;
	ref_url: string | null;
	ref_id: string | null;
	listed_at: string | null;
	first_seen: string;
	removed_at: string | null;
	meta: Record<string, unknown> | null;
}

export async function allEntries(sql: Sql, opts: { activeOnly?: boolean } = {}): Promise<EntryRow[]> {
	const r = await sql.query<EntryRow>(
		`SELECT source, key, chain, address, category, risk, code, entity, reason, ref_url, ref_id, listed_at, first_seen, removed_at, meta
		 FROM oz_entries ${opts.activeOnly ? 'WHERE removed_at IS NULL' : ''} ORDER BY key, source`
	);
	return r.rows;
}

/** How long a flag stays on the incident path unless the maintainer says otherwise. */
export const URGENT_DEFAULT_MS = 48 * 3600_000;

/** A maintainer-supplied source URL is only ever published when it is plain http(s). */
export function httpUrlOrUndefined(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	try {
		const { protocol } = new URL(url);
		return protocol === 'https:' || protocol === 'http:' ? url : undefined;
	} catch {
		return undefined;
	}
}

interface ManualRow {
	id: number;
	address: string;
	chain: string | null;
	reason: string;
	added_by: string | null;
	added_at: string;
	incident?: string | null;
	ref_url?: string | null;
	note?: string | null;
	urgent_until?: string | Date | null;
}

/**
 * Maintainer flags from the existing `manual_flags` table, as entries —
 * with the incident name, source URL and note from oz_manual_meta (0004)
 * when there is one. A flag still inside its urgent window carries
 * `meta.urgent`: the tracer checks it (and whatever it reaches) first.
 */
export async function manualEntries(sql: Sql, now = new Date()): Promise<ListEntry[]> {
	let rows: ManualRow[];
	try {
		rows = (
			await sql.query<ManualRow>(
				`SELECT f.id, f.address, f.chain, f.reason, f.added_by, f.added_at, m.incident, m.ref_url, m.note, m.urgent_until
				 FROM manual_flags f LEFT JOIN oz_manual_meta m ON m.flag_id = f.id WHERE f.active = true`
			)
		).rows;
	} catch {
		// oz_manual_meta not there yet (migration 0004 not applied): plain flags
		rows = (
			await sql.query<ManualRow>(`SELECT id, address, chain, reason, added_by, added_at FROM manual_flags WHERE active = true`)
		).rows;
	}
	const out: ListEntry[] = [];
	for (const row of rows) {
		const parsed = parseListedAddress(row.address, row.chain);
		if (!parsed) continue;
		const p = parsed.parsed;
		const incident = row.incident?.trim() || undefined;
		const note = row.note?.trim() || undefined;
		const refUrl = httpUrlOrUndefined(row.ref_url);
		const urgentUntil = row.urgent_until ? new Date(row.urgent_until) : undefined;
		const urgent = !!urgentUntil && urgentUntil.getTime() > now.getTime();
		out.push({
			source: 'manual',
			key: p.key,
			chain: p.chain,
			address: p.address,
			category: 'manual',
			risk: 'high',
			code: 'MANUAL',
			entity: incident ?? row.reason,
			text: `Flagged by an Ozone maintainer: ${row.reason}${incident ? ` (incident: ${incident})` : ''}${note ? ` — ${note}` : ''}`,
			refUrl: refUrl ?? 'https://ozone.redacted.gg/methodology#manual',
			refId: `manual:${row.id}`,
			listedAt: new Date(row.added_at).toISOString(),
			...(incident || refUrl || urgentUntil
				? {
						meta: {
							...(incident ? { incident } : {}),
							...(refUrl ? { sourceUrl: refUrl } : {}),
							...(urgentUntil ? { urgentUntil: urgentUntil.toISOString() } : {}),
							...(urgent ? { urgent: true } : {})
						}
					}
				: {})
		});
	}
	return out;
}

/**
 * A cheap fingerprint of the active maintainer flags and their incident
 * rows: the worker compares it every few seconds and runs the incident path
 * (sync, trace, publish) as soon as it changes — a flag added, edited or
 * deactivated.
 */
export async function manualFlagsSignature(sql: Sql): Promise<string> {
	const f = await sql.query<{ n: number; max_id: number | null; ids: string | null }>(
		`SELECT count(*)::int AS n, max(id) AS max_id, coalesce(sum(id), 0)::text AS ids FROM manual_flags WHERE active = true`
	);
	const m = await sql
		.query<{ n: number; latest: string | null }>(`SELECT count(*)::int AS n, max(created_at)::text AS latest FROM oz_manual_meta`)
		.catch(() => ({ rows: [{ n: 0, latest: null }] }));
	const a = f.rows[0];
	const b = m.rows[0];
	return `${a?.n ?? 0}:${a?.max_id ?? 0}:${a?.ids ?? 0}|${b?.n ?? 0}:${b?.latest ?? ''}`;
}
