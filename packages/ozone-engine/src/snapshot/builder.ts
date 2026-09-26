/**
 * Builds the signed snapshot from the database: every listed address
 * (active and historical), same-key twins, traced addresses with their best
 * THORChain flows, maintainer flags, minus accepted appeals.
 */
import {
	buildSnapshot,
	keyTwins,
	parseForChain,
	riskFromRank,
	riskRank,
	SUPPORTED_CHAINS,
	type Category,
	type PrivateKeyInfo,
	type Reason,
	type Risk,
	type SnapshotManifestV1,
	type SnapshotSourceInfo
} from '../../../ozone-client/src/index.js';
import { DERIVED_SOURCES, SOURCES } from '../sources/registry.js';
import { allEntries } from '../store/entries.js';
import { isoOf } from '../store/db.js';
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
		service: boolean;
		suppressed: boolean;
	}>(`SELECT key, chain, address, hop, risk, service, suppressed FROM oz_traced WHERE NOT suppressed`);
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
		origin_source: string;
		origin_entity: string | null;
		reason: string;
	}>(
		`SELECT to_key, to_chain, txid, from_address, from_chain, action, relation, height, ts, amount, usd, hop, risk, origin_key, origin_source, origin_entity, reason
		 FROM oz_trace_edges ORDER BY to_key, hop ASC, usd DESC NULLS LAST, ts ASC`
	);
	const edgesByKey = new Map<string, typeof edges.rows>();
	for (const e of edges.rows) {
		const list = edgesByKey.get(e.to_key);
		if (!list) edgesByKey.set(e.to_key, [e]);
		else if (list.length < MAX_TRACE_REASONS) list.push(e);
	}
	let tracedCount = 0;
	for (const t of traced.rows) {
		if (listedKeys.has(t.key)) continue; // listed in its own right; trace adds nothing to the verdict
		for (const e of edgesByKey.get(t.key) ?? []) {
			add(t.key, {
				code: e.relation === 'value' ? `TRACE_${String(e.action).toUpperCase()}` : `TRACE_${e.relation.toUpperCase()}`,
				source: 'thorchain_trace',
				category: 'traced',
				risk: e.risk,
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
		}
		tracedCount++;
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
	version: number;
	manifest: SnapshotManifestV1;
	stats: Record<string, number>;
	size: number;
}

export async function buildAndStoreSnapshot(
	sql: Sql,
	key: PrivateKeyInfo,
	opts: SnapshotBuildOptions & { keep?: number; partSize?: number } = {}
): Promise<StoredSnapshot> {
	const now = opts.now ?? new Date();
	const prev = await sql.query<{ version: string; sha256: string }>(`SELECT version, sha256 FROM oz_snapshots ORDER BY version DESC LIMIT 1`);
	const prevVersion = prev.rows[0] ? Number(prev.rows[0].version) : 0;
	const version = Math.max(prevVersion + 1, Math.floor(now.getTime() / 1000));
	const collected = await collectSnapshot(sql, opts);
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
			partSize: opts.partSize ?? 3_500_000,
			...(prev.rows[0] ? { prev: { version: prevVersion, sha256: prev.rows[0].sha256 } } : {})
		},
		key
	);
	await sql.query(
		`INSERT INTO oz_snapshots (version, built_at, sha256, size, manifest, payload, stats) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		[version, now, built.manifest.payload.sha256, built.payload.length, JSON.stringify(built.manifest), Buffer.from(built.payload), JSON.stringify(collected.stats)]
	);
	const keep = opts.keep ?? 48;
	await sql.query(
		`DELETE FROM oz_snapshots WHERE version NOT IN (SELECT version FROM oz_snapshots ORDER BY version DESC LIMIT $1)`,
		[keep]
	);
	return { version, manifest: built.manifest, stats: collected.stats, size: built.payload.length };
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
