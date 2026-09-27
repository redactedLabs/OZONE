/**
 * Builds the signed snapshot from the database: every listed address
 * (active and historical), same-key twins, traced addresses with their best
 * THORChain flows, maintainer flags, minus accepted appeals.
 */
import {
	buildSnapshot,
	canonicalJson,
	keyTwins,
	parseForChain,
	riskFromRank,
	riskRank,
	sha256Hex,
	splitKey,
	SUPPORTED_CHAINS,
	type Category,
	type PrivateKeyInfo,
	type Reason,
	type Risk,
	type SnapshotManifestV1,
	type SnapshotSourceInfo
} from '../../../ozone-client/src/index.js';
import { CORE_SOURCES, DERIVED_SOURCES, SOURCES } from '../sources/registry.js';
import { allEntries } from '../store/entries.js';
import { isoOf } from '../store/db.js';
import { dustTotals, getState, loadDustGroups, setState } from '../store/trace.js';
import { DEFAULT_TRACE_CONFIG, SMALL_TRANSFERS, describeSmallTransfers, traceRisk, type SmallTransferTotal } from '../trace/tracer.js';
import { TWIN_CATEGORIES } from '../policy.js';
import type { Sql } from '../types.js';

export const GENERATOR = 'ozone-engine/1.0.0';
/** Traced flows kept per address in the snapshot (the strongest first). */
const MAX_TRACE_REASONS = 3;
/** Categories whose listing is never suppressed by an appeal (only the source can delist). */
const OFFICIAL: ReadonlySet<string> = new Set(['sanctions', 'law_enforcement']);

export interface SnapshotBuildOptions {
	now?: Date;
	/** Twins of listed addresses (default on). */
	twins?: boolean;
	/** Keep delisted / unfrozen reasons as history (default on). */
	history?: boolean;
}

export interface CollectedSnapshot {
	records: Array<{ key: string; reasons: Reason[] }>;
	sources: SnapshotSourceInfo[];
	stats: Record<string, number>;
}

const lower = (r: Risk): Risk => riskFromRank(Math.max(riskRank('low'), riskRank(r) - 1));


export async function collectSnapshot(sql: Sql, opts: SnapshotBuildOptions = {}): Promise<CollectedSnapshot> {
	const withHistory = opts.history !== false;
	const suppressed = new Set(
		(await sql.query<{ key: string }>(`SELECT key FROM oz_overrides WHERE active AND action = 'suppress'`)).rows.map((r) => r.key)
	);
	const byKey = new Map<string, Reason[]>();
	const add = (key: string, r: Reason) => {
		if (suppressed.has(key) && !OFFICIAL.has(r.category)) return;
		const list = byKey.get(key);
		if (list) list.push(r);
		else byKey.set(key, [r]);
	};
	const sourceCounts = new Map<string, number>();
	const bump = (id: string) => sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);

	const entries = await allEntries(sql, { activeOnly: !withHistory });
	const listedKeys = new Set<string>();
	for (const e of entries) {
		const reason: Reason = {
			code: e.code,
			source: e.source,
			category: e.category as Category,
			risk: e.risk as Risk,
			text: e.reason,
			...(e.entity ? { entity: e.entity } : {}),
			chain: e.chain,
			...(e.ref_url ? { ref: e.ref_url } : {}),
			...(e.ref_id ? { refId: e.ref_id } : {}),
			...(e.listed_at ? { listedAt: isoOf(e.listed_at) } : {}),
			firstSeen: isoOf(e.first_seen),
			...(e.removed_at ? { removedAt: isoOf(e.removed_at) } : {})
		};
		add(e.key, reason);
		if (!e.removed_at) {
			listedKeys.add(e.key);
			bump(e.source);
		}
	}
	// same-key twins of active listings
	let twins = 0;
	if (opts.twins !== false) {
		for (const e of entries) {
			// only strong listings: a twin of a medium-risk (phishing) entry would be
			// low risk — never flagged by any sensible policy, just snapshot weight
			if (e.removed_at || !TWIN_CATEGORIES.has(e.category)) continue;
			const p = parseForChain(e.address, e.chain);
			if (!p) continue;
			for (const t of keyTwins(p)) {
				if (listedKeys.has(t.key)) continue;
				add(t.key, {
					code: 'SAME_KEY',
					source: 'key_twin',
					category: 'key_twin',
					risk: lower(e.risk as Risk),
					text: `Controlled by the same private key as ${e.address} (${e.chain}): ${e.reason}`,
					...(e.entity ? { entity: e.entity } : {}),
					chain: t.chain,
					...(e.ref_url ? { ref: e.ref_url } : {}),
					refId: `${e.source}:${e.key}`
				});
				twins++;
			}
		}
		if (twins) sourceCounts.set('key_twin', twins);
	}

	// traced addresses: best flows per address
	const traced = await sql.query<{
		key: string;
		chain: string;
		address: string;
		hop: number;
		risk: Risk;
		origin_key: string;
		origin_source: string;
		origin_entity: string | null;
		first_txid: string;
		service: boolean;
		suppressed: boolean;
	}>(`SELECT key, chain, address, hop, risk, origin_key, origin_source, origin_entity, first_txid, service, suppressed FROM oz_traced WHERE NOT suppressed`);
	const edges = await sql.query<{
		to_key: string;
		to_chain: string;
		txid: string;
		from_address: string;
		from_chain: string;
		action: string;
		relation: string;
		height: string | number | null;
		ts: string | null;
		amount: string | null;
		usd: string | number | null;
		hop: number;
		risk: Risk;
		origin_key: string;
		origin_risk: Risk;
		origin_source: string;
		origin_entity: string | null;
		reason: string;
	}>(
		`SELECT to_key, to_chain, txid, from_address, from_chain, action, relation, height, ts, amount, usd, hop, risk, origin_key, origin_risk, origin_source, origin_entity, reason
		 FROM oz_trace_edges
		 ORDER BY to_key,
		   array_position(ARRAY['none','info','low','medium','high','severe'], risk) DESC,
		   hop ASC,
		   usd DESC NULLS FIRST,
		   ts ASC`
	);
	type EdgeRow = (typeof edges.rows)[number];
	const edgeReason = (e: EdgeRow, risk: Risk): Reason => ({
		code: e.relation === 'value' ? `TRACE_${String(e.action).toUpperCase()}` : `TRACE_${e.relation.toUpperCase()}`,
		source: 'thorchain_trace',
		category: 'traced',
		risk,
		text: e.reason,
		chain: e.to_chain,
		refId: e.txid,
		ref: `https://runescan.io/tx/${e.txid}`,
		trace: {
			hop: Number(e.hop),
			action: e.action,
			txid: e.txid,
			...(e.height ? { height: Number(e.height) } : {}),
			...(e.ts ? { date: isoOf(e.ts) } : {}),
			from: e.from_address,
			fromChain: e.from_chain,
			...(e.amount ? { amount: e.amount } : {}),
			...(e.usd !== null ? { usd: Math.round(Number(e.usd)) } : {}),
			originKey: e.origin_key,
			originSource: e.origin_source,
			...(e.origin_entity ? { originEntity: e.origin_entity } : {})
		}
	});
	// Every edge, keyed by (to_key, txid): lets the oz_traced backstop below
	// find the exact edge behind its best-recorded risk even when that edge
	// was not among the top MAX_TRACE_REASONS kept for publishing.
	const edgeByToKeyTxid = new Map<string, EdgeRow>();
	for (const e of edges.rows) edgeByToKeyTxid.set(`${e.to_key}\u0000${e.txid}`, e);

	// Per-flow USD thresholds demote a flow that is, on its own, below the
	// "full" amount for its hop — but several such flows from the same origin
	// to the same recipient still add up (structuring). Aggregate every
	// known-usd value edge by (origin, recipient, hop), plus flows that never
	// got their own edge for being under the dust limit (oz_trace_dust_flows,
	// one row per flow, so a replayed action is never counted twice), and
	// republish at the undemoted risk once the sum reaches the hop's full-USD
	// threshold.
	const trace = DEFAULT_TRACE_CONFIG;
	const groupKey = (originKey: string, toKey: string, hop: number) => `${originKey}\u0000${toKey}\u0000${Number(hop)}`;
	const groupTotals = new Map<string, number>();
	for (const e of edges.rows) {
		if (e.relation !== 'value' || e.usd === null) continue;
		const k = groupKey(e.origin_key, e.to_key, e.hop);
		groupTotals.set(k, (groupTotals.get(k) ?? 0) + Number(e.usd));
	}
	const dust = await dustTotals(sql);
	for (const d of dust) {
		const k = groupKey(d.originKey, d.toKey, d.hop);
		groupTotals.set(k, (groupTotals.get(k) ?? 0) + d.usd);
	}
	const undemotedRisk = (originRisk: Risk, hop: number): Risk =>
		riskFromRank(Math.max(Math.min(riskRank(originRisk), riskRank('high')) - (hop - 1), riskRank('low')));
	const crossesFullUsd = (hop: number, sum: number) => sum >= (hop === 1 ? trace.hop1FullUsd : trace.deepFullUsd);

	// A recipient built entirely from sub-dust transfers has no edge to
	// publish: once an (origin, hop) total of them reaches the dust limit it
	// gets one TRACE_SMALL_TRANSFERS reason, at the risk one flow of that
	// total would get. (A group that also has an edge is published through
	// its edges, with the small transfers already in the sum above.)
	const edgeGroups = new Set(edges.rows.map((e) => groupKey(e.origin_key, e.to_key, e.hop)));
	const smallTotals = await loadDustGroups(
		sql,
		trace.dustUsd,
		dust.filter((d) => d.usd >= trace.dustUsd && !edgeGroups.has(groupKey(d.originKey, d.toKey, d.hop)))
	);
	const smallTransferReason = (st: SmallTransferTotal, risk: Risk): Reason => {
		const c = st.crossing!;
		return {
			code: `TRACE_${SMALL_TRANSFERS.toUpperCase()}`,
			source: 'thorchain_trace',
			category: 'traced',
			risk,
			text: describeSmallTransfers(st, trace),
			chain: st.toChain,
			refId: c.txid,
			ref: `https://runescan.io/tx/${c.txid}`,
			trace: {
				hop: st.hop,
				action: SMALL_TRANSFERS,
				txid: c.txid,
				...(c.height ? { height: c.height } : {}),
				date: c.date,
				from: c.fromAddress,
				fromChain: c.fromChain,
				amount: `${st.count} transfers`,
				usd: Math.round(st.usd),
				originKey: st.originKey,
				originSource: st.originSource,
				...(st.originEntity ? { originEntity: st.originEntity } : {})
			}
		};
	};

	// Candidate reasons per address, each at the risk it is published with.
	// The strongest MAX_TRACE_REASONS are kept: risk first, then hop, then
	// USD (unpriced first: unknown, not small), then time.
	interface Candidate {
		risk: Risk;
		hop: number;
		usd: number | null;
		time: number;
		small: boolean;
		reason: () => Reason;
	}
	const candidates = new Map<string, Candidate[]>();
	const offer = (key: string, c: Candidate) => {
		const list = candidates.get(key);
		if (list) list.push(c);
		else candidates.set(key, [c]);
	};
	for (const e of edges.rows) {
		const sum = e.relation === 'value' ? groupTotals.get(groupKey(e.origin_key, e.to_key, e.hop)) : undefined;
		const risk = sum !== undefined && crossesFullUsd(e.hop, sum) ? undemotedRisk(e.origin_risk, e.hop) : e.risk;
		offer(e.to_key, {
			risk,
			hop: Number(e.hop),
			usd: e.usd === null ? null : Number(e.usd),
			time: e.ts ? new Date(e.ts).getTime() : 0,
			small: false,
			reason: () => edgeReason(e, risk)
		});
	}
	for (const st of smallTotals) {
		const risk = st.crossing ? traceRisk(st.originRisk, st.hop, st.usd, 'value', trace) : null;
		if (!risk) continue;
		offer(st.toKey, { risk, hop: st.hop, usd: st.usd, time: Date.parse(st.crossing!.date), small: true, reason: () => smallTransferReason(st, risk) });
	}
	const strongestFirst = (a: Candidate, b: Candidate) =>
		riskRank(b.risk) - riskRank(a.risk) ||
		a.hop - b.hop ||
		(a.usd === null ? (b.usd === null ? 0 : -1) : b.usd === null ? 1 : b.usd - a.usd) ||
		a.time - b.time;
	const strongest = (key: string, onlySmall = false) =>
		(candidates.get(key) ?? [])
			.filter((c) => !onlySmall || c.small)
			.sort(strongestFirst)
			.slice(0, MAX_TRACE_REASONS);

	let tracedCount = 0;
	const tracedKeys = new Set<string>();
	for (const t of traced.rows) {
		tracedKeys.add(t.key);
		if (listedKeys.has(t.key)) continue; // listed in its own right; trace adds nothing to the verdict
		let bestPublished: Risk = 'none';
		for (const c of strongest(t.key)) {
			if (riskRank(c.risk) > riskRank(bestPublished)) bestPublished = c.risk;
			add(t.key, c.reason());
		}
		// Backstop: oz_traced.risk is the address's true best-recorded reason
		// (lowest hop, highest risk seen there) and must never be higher than
		// what the truncated top-MAX_TRACE_REASONS actually published. If the
		// cutoff or the aggregation above ever misses it, surface it directly.
		if (riskRank(t.risk) > riskRank(bestPublished)) {
			const fallback = edgeByToKeyTxid.get(`${t.key}\u0000${t.first_txid}`);
			add(
				t.key,
				fallback
					? edgeReason(fallback, t.risk)
					: {
							code: 'TRACE_BEST',
							source: 'thorchain_trace',
							category: 'traced',
							risk: t.risk,
							text: `Traced at hop ${t.hop} via ${t.origin_source}${t.origin_entity ? ` (${t.origin_entity})` : ''}; detail edge not in the published top ${MAX_TRACE_REASONS}`,
							chain: t.chain,
							refId: t.first_txid,
							trace: {
								hop: Number(t.hop),
								action: 'unknown',
								txid: t.first_txid,
								from: splitKey(t.origin_key)?.address ?? t.origin_key,
								originKey: t.origin_key,
								originSource: t.origin_source,
								...(t.origin_entity ? { originEntity: t.origin_entity } : {})
							}
						}
			);
		}
		tracedCount++;
	}
	// A recipient traced only by small-transfer totals has no oz_traced row
	// when the fan-out cap kept it from being followed onward: it is published
	// all the same (an accepted appeal suppresses it like any traced address).
	const suppressedTraced = new Set((await sql.query<{ key: string }>(`SELECT key FROM oz_traced WHERE suppressed`)).rows.map((r) => r.key));
	for (const key of new Set(smallTotals.map((st) => st.toKey))) {
		if (tracedKeys.has(key) || suppressedTraced.has(key) || listedKeys.has(key)) continue;
		const kept = strongest(key, true);
		for (const c of kept) add(key, c.reason());
		if (kept.length) tracedCount++;
	}
	if (tracedCount) sourceCounts.set('thorchain_trace', tracedCount);

	// THORChain accounts linked to listed L1 addresses (computed by the user screening)
	let linked = 0;
	const users = await sql.query<{ thor_address: string; flag_detail: Array<{ via: string; code: string; source: string; risk: Risk; text: string }> | string | null }>(
		`SELECT thor_address, flag_detail FROM rujira_users WHERE flag_detail IS NOT NULL AND thor_address LIKE 'thor1%'`
	);
	for (const u of users.rows) {
		const detail = typeof u.flag_detail === 'string' ? JSON.parse(u.flag_detail) : u.flag_detail;
		let any = false;
		for (const d of detail ?? []) {
			if (!d.code?.startsWith('LINKED_')) continue;
			add(`thor:${u.thor_address}`, {
				code: d.code,
				source: 'thorchain_links',
				category: 'linked',
				risk: d.risk,
				text: d.text,
				chain: 'THOR',
				refId: d.via
			});
			any = true;
		}
		if (any) linked++;
	}
	if (linked) sourceCounts.set('thorchain_links', linked);

	// source descriptors (only sources referenced by reasons or known)
	const dbSources = await sql.query<{ id: string; last_success_at: string | null; last_version: string | null }>(
		`SELECT id, last_success_at, last_version FROM oz_sources`
	);
	const dbInfo = new Map(dbSources.rows.map((r) => [r.id, r]));
	const referenced = new Set<string>();
	for (const reasons of byKey.values()) {
		for (const r of reasons) {
			referenced.add(r.source);
			if (r.trace) referenced.add(r.trace.originSource);
		}
	}
	const sources: SnapshotSourceInfo[] = [];
	for (const s of [...SOURCES, ...DERIVED_SOURCES]) {
		if (!referenced.has(s.id) && !dbInfo.has(s.id)) continue;
		const info = dbInfo.get(s.id);
		sources.push({
			id: s.id,
			name: s.name,
			kind: s.kind,
			url: s.url,
			...(info?.last_success_at ? { lastSuccessAt: isoOf(info.last_success_at) } : {}),
			...(info?.last_version ? { version: info.last_version } : {}),
			entries: sourceCounts.get(s.id) ?? 0
		});
	}
	for (const id of referenced) {
		if (!sources.some((s) => s.id === id)) sources.push({ id, name: id, kind: 'other', entries: sourceCounts.get(id) ?? 0 });
	}

	const records = [...byKey.entries()].map(([key, reasons]) => ({ key, reasons }));
	const stats: Record<string, number> = {
		listed: listedKeys.size,
		traced: tracedCount,
		twins,
		linkedAccounts: linked,
		keys: records.length
	};
	return { records, sources, stats };
}

export interface StoredSnapshot {
	published: true;
	version: number;
	manifest: SnapshotManifestV1;
	stats: Record<string, number>;
	size: number;
	/** True when the content equalled the latest snapshot's and that one was kept (nothing published). */
	unchanged?: boolean;
}

/** Nothing was signed or stored: the core sources haven't synced, or the count drop looked like data loss. */
export interface SnapshotRefusal {
	published: false;
	/** Human-readable, always prefixed "not published: …" — safe to log as-is. */
	reason: string;
}

export type PublishResult = StoredSnapshot | SnapshotRefusal;

export interface StoreOptions extends SnapshotBuildOptions {
	/** Snapshots kept in the database (default 12; nodes only need the newest, mirrors a few). */
	keep?: number;
	partSize?: number;
	/**
	 * Unchanged content is not republished (nodes would download identical
	 * data every cycle) unless the latest snapshot is older than this
	 * (default 6 h), so its age still proves liveness.
	 */
	republishAfterMs?: number;
	/**
	 * Source ids that must each have `oz_sources.last_success_at` set and at
	 * least their registry `minEntries` active entries before anything is
	 * signed (default: CORE_SOURCES). Pass `[]` to disable the check
	 * (tests exercising unrelated behaviour on partial fixture data only —
	 * never for the worker or the app).
	 */
	coreSources?: readonly string[];
	/** Refuse a publish whose key count falls more than this fraction below the previous snapshot's (default 0.2). */
	maxKeyDropRatio?: number;
}

/** Per-source minEntries, defaulting to 1 (at least synced with something) when a source declares none. */
function minEntriesFor(id: string): number {
	const def = SOURCES.find((s) => s.id === id);
	return def?.minEntries ?? 1;
}

/** Checks the core-source completeness gate; returns a reason string when it fails, otherwise undefined. */
async function checkCoreSources(sql: Sql, ids: readonly string[]): Promise<string | undefined> {
	if (!ids.length) return undefined;
	const rows = await sql.query<{ id: string; last_success_at: string | null; active_count: number }>(
		`SELECT id, last_success_at, active_count FROM oz_sources WHERE id = ANY($1::text[])`,
		[ids as string[]]
	);
	const byId = new Map(rows.rows.map((r) => [r.id, r]));
	const problems: string[] = [];
	for (const id of ids) {
		const min = minEntriesFor(id);
		const row = byId.get(id);
		if (!row || !row.last_success_at) problems.push(`${id} (never synced)`);
		else if (row.active_count < min) problems.push(`${id} (${row.active_count} active, need ${min})`);
	}
	return problems.length ? `core source(s) not ready: ${problems.join(', ')}` : undefined;
}

/** What a snapshot says about addresses — without version, build time or sync timestamps. */
function contentHash(json: BuiltSnapshotJson): string {
	return sha256Hex(
		new TextEncoder().encode(
			canonicalJson({
				chains: json.chains,
				sources: json.sources.map((src) => ({ id: src.id, entries: src.entries })),
				strings: json.strings,
				records: json.records
			})
		)
	);
}
type BuiltSnapshotJson = ReturnType<typeof buildSnapshot>['json'];

export async function buildAndStoreSnapshot(sql: Sql, key: PrivateKeyInfo, opts: StoreOptions = {}): Promise<PublishResult> {
	const now = opts.now ?? new Date();
	const prev = await sql.query<{ version: string; sha256: string; built_at: string; size: number; manifest: SnapshotManifestV1 | string; stats: Record<string, number> | string | null }>(
		`SELECT version, sha256, built_at, size, manifest, stats FROM oz_snapshots ORDER BY version DESC LIMIT 1`
	);
	const prevVersion = prev.rows[0] ? Number(prev.rows[0].version) : 0;
	const version = Math.max(prevVersion + 1, Math.floor(now.getTime() / 1000));

	// Nothing gets signed until the core sources have synced — an empty or
	// half-loaded database must never produce a signed "clean" answer.
	const coreProblem = await checkCoreSources(sql, opts.coreSources ?? CORE_SOURCES);
	if (coreProblem) return { published: false, reason: `not published: ${coreProblem}` };

	const collected = await collectSnapshot(sql, opts);

	// Nor may a snapshot silently re-sign a large, unexplained loss of keys
	// (e.g. a database restore that bypassed applySourceResult's own gate).
	const prevStats = prev.rows[0]
		? typeof prev.rows[0].stats === 'string'
			? (JSON.parse(prev.rows[0].stats) as Record<string, number>)
			: prev.rows[0].stats
		: undefined;
	const prevKeys = prevStats?.keys;
	const maxKeyDropRatio = opts.maxKeyDropRatio ?? 0.2;
	if (typeof prevKeys === 'number' && prevKeys > 0 && collected.stats.keys < prevKeys * (1 - maxKeyDropRatio)) {
		return {
			published: false,
			reason: `not published: active key count would drop from ${prevKeys} to ${collected.stats.keys} (more than ${Math.round(maxKeyDropRatio * 100)}%)`
		};
	}

	const partSize = opts.partSize ?? 3_500_000;
	const built = buildSnapshot(
		{
			version,
			builtAt: now.toISOString(),
			generator: GENERATOR,
			chains: SUPPORTED_CHAINS,
			sources: collected.sources,
			records: collected.records,
			stats: collected.stats,
			payloadUrl: `./snapshot/${version}`,
			// Vercel functions answer at most 4.5 MB: larger payloads are served in parts
			partSize,
			...(prev.rows[0] ? { prev: { version: prevVersion, sha256: prev.rows[0].sha256 } } : {})
		},
		key
	);
	const content = contentHash(built.json);
	const last = prev.rows[0];
	if (last) {
		const state = await getState<{ version: number; content: string; partSize?: number }>(sql, 'snapshot:content');
		const age = now.getTime() - Date.parse(isoOf(last.built_at) ?? '');
		const same = state?.version === prevVersion && state.content === content && state.partSize === partSize;
		if (same && age >= 0 && age < (opts.republishAfterMs ?? 6 * 3_600_000)) {
			const manifest = typeof last.manifest === 'string' ? (JSON.parse(last.manifest) as SnapshotManifestV1) : last.manifest;
			const stats = typeof last.stats === 'string' ? (JSON.parse(last.stats) as Record<string, number>) : (last.stats ?? collected.stats);
			return { published: true, version: prevVersion, manifest, stats, size: Number(last.size), unchanged: true };
		}
	}
	await sql.query(
		`INSERT INTO oz_snapshots (version, built_at, sha256, size, manifest, payload, stats) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		[version, now, built.manifest.payload.sha256, built.payload.length, JSON.stringify(built.manifest), Buffer.from(built.payload), JSON.stringify(collected.stats)]
	);
	await setState(sql, 'snapshot:content', { version, content, partSize });
	const keep = opts.keep ?? 12;
	await sql.query(
		`DELETE FROM oz_snapshots WHERE version NOT IN (SELECT version FROM oz_snapshots ORDER BY version DESC LIMIT $1)`,
		[keep]
	);
	return { published: true, version, manifest: built.manifest, stats: collected.stats, size: built.payload.length };
}

export async function latestSnapshot(sql: Sql): Promise<{ version: number; manifest: SnapshotManifestV1; builtAt: string } | undefined> {
	const r = await sql.query<{ version: string; manifest: SnapshotManifestV1 | string; built_at: string }>(
		`SELECT version, manifest, built_at FROM oz_snapshots ORDER BY version DESC LIMIT 1`
	);
	const row = r.rows[0];
	if (!row) return undefined;
	const manifest = typeof row.manifest === 'string' ? (JSON.parse(row.manifest) as SnapshotManifestV1) : row.manifest;
	return { version: Number(row.version), manifest, builtAt: isoOf(row.built_at)! };
}

export async function snapshotPayload(sql: Sql, version: number): Promise<Uint8Array | undefined> {
	const r = await sql.query<{ payload: Uint8Array | Buffer }>(`SELECT payload FROM oz_snapshots WHERE version = $1`, [version]);
	const p = r.rows[0]?.payload;
	return p ? new Uint8Array(p) : undefined;
}
