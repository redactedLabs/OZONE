/**
 * Trace persistence: edges (every flow that flagged something), small
 * transfers under the dust limit (to be added up), the best reason per
 * traced address, the tracer's index and Midgard progress.
 */
import { keyTwins, parseForChain, riskFromRank, riskRank, splitKey, type Category, type Risk } from '../../../ozone-client/src/index.js';
import {
	DEFAULT_TRACE_CONFIG,
	SMALL_TRANSFERS,
	isTraceOrigin,
	describeHit,
	traceRisk,
	type DustFlow,
	type IndexEntry,
	type PayerLink,
	type SmallTransferTotal,
	type TraceConfig,
	type TraceHit
} from '../trace/tracer.js';
import type { Logger, Sql } from '../types.js';
import { silentLogger } from '../types.js';
import { TWIN_CATEGORIES } from '../policy.js';
import { CURATED } from '../sources/curated-data.js';
import { batchInsert, isoOf } from './db.js';

export async function recordHits(sql: Sql, hits: TraceHit[]): Promise<{ edges: number; traced: number }> {
	if (!hits.length) return { edges: 0, traced: 0 };
	await batchInsert(
		sql,
		`INSERT INTO oz_trace_edges (txid, from_key, from_address, from_chain, to_key, to_chain, to_address, action, relation, height, ts,
			amount, usd, hop, risk, origin_key, origin_source, origin_entity, origin_risk, origin_category, reason)`,
		21,
		hits.map((h) => [
			h.txid,
			h.fromKey,
			h.fromAddress,
			h.fromChain,
			h.toKey,
			h.toChain,
			h.toAddress,
			h.action,
			h.relation,
			h.height,
			new Date(h.date),
			h.amount ?? null,
			h.usd ?? null,
			h.hop,
			h.risk,
			h.originKey,
			h.originSource,
			h.originEntity ?? null,
			h.originRisk,
			h.originCategory,
			describeHit(h)
		]),
		// a replay keeps the stored edge; only its wording follows the code (same hop), so a re-read after a wording change refreshes the reasons
		`ON CONFLICT (txid, from_key, to_key) DO UPDATE SET reason = EXCLUDED.reason
		 WHERE oz_trace_edges.hop = EXCLUDED.hop AND oz_trace_edges.reason IS DISTINCT FROM EXCLUDED.reason`
	);
	const best = bestPerTarget(hits);
	await upsertTraced(sql, best);
	return { edges: hits.length, traced: best.length };
}

/** Best reason per target: lowest hop, then highest risk, then largest value. */
function bestPerTarget(hits: TraceHit[]): TraceHit[] {
	const best = new Map<string, TraceHit>();
	for (const h of hits) {
		const b = best.get(h.toKey);
		if (
			!b ||
			h.hop < b.hop ||
			(h.hop === b.hop && riskRank(h.risk) > riskRank(b.risk)) ||
			(h.hop === b.hop && h.risk === b.risk && (h.usd ?? 0) > (b.usd ?? 0))
		) {
			best.set(h.toKey, h);
		}
	}
	return [...best.values()];
}

/**
 * Upserts traced addresses (one hit per key): a lower hop replaces the
 * origin and first transaction, a higher risk at the same hop replaces the
 * risk, the taint height only ever moves earlier.
 */
async function upsertTraced(sql: Sql, best: TraceHit[]): Promise<void> {
	if (!best.length) return;
	await batchInsert(
		sql,
		`INSERT INTO oz_traced (key, chain, address, hop, risk, usd, origin_key, origin_source, origin_entity, origin_risk, origin_category,
			first_txid, first_height, first_ts, edges, updated_at)`,
		16,
		best.map((h) => [
			h.toKey,
			h.toChain,
			h.toAddress,
			h.hop,
			h.risk,
			h.usd ?? null,
			h.originKey,
			h.originSource,
			h.originEntity ?? null,
			h.originRisk,
			h.originCategory,
			h.txid,
			h.height,
			new Date(h.date),
			1,
			new Date()
		]),
		`ON CONFLICT (key) DO UPDATE SET
			updated_at = EXCLUDED.updated_at,
			first_height = LEAST(oz_traced.first_height, EXCLUDED.first_height),
			first_ts = LEAST(oz_traced.first_ts, EXCLUDED.first_ts),
			hop = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.hop ELSE oz_traced.hop END,
			risk = CASE WHEN EXCLUDED.hop < oz_traced.hop OR (EXCLUDED.hop = oz_traced.hop AND
				array_position(ARRAY['none','info','low','medium','high','severe'], EXCLUDED.risk) >
				array_position(ARRAY['none','info','low','medium','high','severe'], oz_traced.risk))
				THEN EXCLUDED.risk ELSE oz_traced.risk END,
			usd = GREATEST(oz_traced.usd, EXCLUDED.usd),
			origin_key = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.origin_key ELSE oz_traced.origin_key END,
			origin_source = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.origin_source ELSE oz_traced.origin_source END,
			origin_entity = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.origin_entity ELSE oz_traced.origin_entity END,
			origin_risk = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.origin_risk ELSE oz_traced.origin_risk END,
			origin_category = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.origin_category ELSE oz_traced.origin_category END,
			first_txid = CASE WHEN EXCLUDED.hop < oz_traced.hop THEN EXCLUDED.first_txid ELSE oz_traced.first_txid END`
	);
	const keys = best.map((h) => h.toKey);
	for (let i = 0; i < keys.length; i += 1000) {
		await sql.query(
			`UPDATE oz_traced t SET edges = (SELECT count(*) FROM oz_trace_edges e WHERE e.to_key = t.key) WHERE t.key = ANY($1::text[])`,
			[keys.slice(i, i + 1000)]
		);
	}
}

const groupId = (originKey: string, toKey: string, hop: number) => `${originKey}\u0000${toKey}\u0000${hop}`;

export interface DustRecordResult {
	/** Distinct small transfers in the batch (including ones recorded before). */
	flows: number;
	/** Recipients newly traced — and so followed onward — by a small-transfer total. */
	traced: number;
	/** Recipients whose total reached the dust limit but that the fan-out cap kept from being followed onward. */
	skipped: number;
}

/**
 * Records value flows that were under the dust limit on their own
 * (traceAction's `onDust`) in oz_trace_dust_flows: one row per flow, keyed
 * like oz_trace_edges by (txid, from_key, to_key). Replaying an action — the
 * backfill re-reading an address, a retry after a crash, the real-time
 * follower and the backfill both seeing it, overlapping cursors — finds the
 * existing row and adds nothing; totals are SUMs over rows (dustTotals),
 * never a counter that grows on every read. A replay from a lower hop (the
 * sender has since been traced closer to a listed address) moves the flow to
 * that hop's group instead of counting it a second time.
 *
 * Then every (origin, recipient, hop) the batch touched is re-totalled from
 * the ledger: a recipient whose total reaches the dust limit is traced
 * (oz_traced, so it is followed onward like any other traced key) with the
 * risk one flow of that total would get. Per origin and hop, at most
 * `cfg.maxDustRecipients` recipients are traced this way (fan-out cap, most
 * value first); the rest are logged and left to the snapshot, which still
 * publishes them. The result is re-derived from the ledger on every call, so
 * a crash between the two steps heals on the next read of the same action.
 */
export async function recordDustFlows(
	sql: Sql,
	dust: DustFlow[],
	cfg: TraceConfig = DEFAULT_TRACE_CONFIG,
	logger: Logger = silentLogger
): Promise<DustRecordResult> {
	if (!dust.length) return { flows: 0, traced: 0, skipped: 0 };
	// one row per flow in the statement (ON CONFLICT DO UPDATE refuses to touch a row twice)
	const byFlow = new Map<string, DustFlow>();
	for (const d of dust) {
		const k = `${d.txid}\u0000${d.fromKey}\u0000${d.toKey}`;
		const cur = byFlow.get(k);
		if (!cur || d.hop < cur.hop) byFlow.set(k, d);
	}
	const flows = [...byFlow.values()];
	await batchInsert(
		sql,
		`INSERT INTO oz_trace_dust_flows (txid, from_key, from_address, from_chain, to_key, to_chain, to_address, action, height, ts,
			amount, usd, hop, origin_key, origin_source, origin_entity, origin_risk, origin_category)`,
		18,
		flows.map((d) => [
			d.txid,
			d.fromKey,
			d.fromAddress,
			d.fromChain,
			d.toKey,
			d.toChain,
			d.toAddress,
			d.action,
			d.height,
			new Date(d.date),
			d.amount ?? null,
			d.usd,
			d.hop,
			d.originKey,
			d.originSource,
			d.originEntity ?? null,
			d.originRisk,
			d.originCategory
		]),
		`ON CONFLICT (txid, from_key, to_key) DO UPDATE SET
			hop = EXCLUDED.hop,
			origin_key = EXCLUDED.origin_key,
			origin_source = EXCLUDED.origin_source,
			origin_entity = EXCLUDED.origin_entity,
			origin_risk = EXCLUDED.origin_risk,
			origin_category = EXCLUDED.origin_category
		 WHERE EXCLUDED.hop < oz_trace_dust_flows.hop`
	);
	const touched = new Map<string, { originKey: string; toKey: string; hop: number }>();
	for (const d of flows) touched.set(groupId(d.originKey, d.toKey, d.hop), { originKey: d.originKey, toKey: d.toKey, hop: d.hop });
	return { flows: flows.length, ...(await traceSmallTransferTotals(sql, [...touched.values()], cfg, logger)) };
}

/**
 * Traces the recipients of the given groups whose small-transfer total
 * reached the dust limit, under the fan-out cap. The cap is counted from the
 * database, so it holds across runs and restarts; two writers deciding at
 * the same moment (the backfill and the real-time follower) can each take
 * the last slot, i.e. overshoot it by one at most.
 */
async function traceSmallTransferTotals(
	sql: Sql,
	groups: Array<{ originKey: string; toKey: string; hop: number }>,
	cfg: TraceConfig,
	logger: Logger
): Promise<{ traced: number; skipped: number }> {
	const due: Array<{ t: SmallTransferTotal; risk: Risk }> = [];
	for (const t of await loadDustGroups(sql, cfg.dustUsd, groups)) {
		// the risk one flow of the whole total would get (same hop demotion rules)
		const risk = t.crossing ? traceRisk(t.originRisk, t.hop, t.usd, 'value', cfg) : null;
		if (risk) due.push({ t, risk });
	}
	if (!due.length) return { traced: 0, skipped: 0 };

	// Where each recipient already stands, and how many recipients every
	// (origin, hop) already has followed on small-transfer totals alone
	// (traced there, with no edge from anyone at that hop or closer that
	// would have made it a traced key anyway).
	const current = new Map(
		(
			await sql.query<{ key: string; hop: number }>(`SELECT key, hop FROM oz_traced WHERE key = ANY($1::text[])`, [[...new Set(due.map((x) => x.t.toKey))]])
		).rows.map((r) => [r.key, Number(r.hop)])
	);
	const pairs = new Map<string, { originKey: string; hop: number }>();
	for (const { t } of due) pairs.set(`${t.originKey}\u0000${t.hop}`, { originKey: t.originKey, hop: t.hop });
	const used = new Map(
		(
			await sql.query<{ origin_key: string; hop: number; n: number }>(
				`SELECT t.origin_key, t.hop, count(*)::int AS n
				 FROM oz_traced t
				 JOIN unnest($1::text[], $2::int[]) AS p(origin_key, hop) ON p.origin_key = t.origin_key AND p.hop = t.hop
				 WHERE NOT EXISTS (SELECT 1 FROM oz_trace_edges e WHERE e.to_key = t.key AND e.hop <= t.hop)
				 GROUP BY t.origin_key, t.hop`,
				[[...pairs.values()].map((p) => p.originKey), [...pairs.values()].map((p) => p.hop)]
			)
		).rows.map((r) => [`${r.origin_key}\u0000${Number(r.hop)}`, Number(r.n)])
	);

	// Most value first (then the earliest to cross): the cap keeps the strongest.
	due.sort((a, b) => b.t.usd - a.t.usd || a.t.crossing!.height - b.t.crossing!.height || (a.t.toKey < b.t.toKey ? -1 : a.t.toKey > b.t.toKey ? 1 : 0));
	const hits: TraceHit[] = [];
	const skipped = new Map<string, string[]>();
	let traced = 0;
	for (const { t, risk } of due) {
		const hop = current.get(t.toKey);
		if (hop !== undefined && hop <= t.hop) {
			// already followed at this hop or closer: no new work (may raise its risk)
			hits.push(smallTransferHit(t, risk));
			continue;
		}
		const pair = `${t.originKey}\u0000${t.hop}`;
		const n = used.get(pair) ?? 0;
		if (n < cfg.maxDustRecipients) {
			used.set(pair, n + 1);
			current.set(t.toKey, t.hop);
			hits.push(smallTransferHit(t, risk));
			traced++;
		} else {
			skipped.set(pair, [...(skipped.get(pair) ?? []), t.toKey]);
		}
	}
	await upsertTraced(sql, bestPerTarget(hits));
	let nSkipped = 0;
	for (const [pair, keys] of skipped) {
		nSkipped += keys.length;
		const [originKey, hop] = pair.split('\u0000');
		logger.warn(
			`trace: small-transfer fan-out cap reached for ${originKey} at hop ${hop} (${cfg.maxDustRecipients} recipients followed onward): ` +
				`${keys.length} more published but not traced further: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', …' : ''}`
		);
	}
	return { traced, skipped: nSkipped };
}

/** The oz_traced row of a recipient traced by a small-transfer total: its crossing transfer, carrying the whole total. */
function smallTransferHit(t: SmallTransferTotal, risk: Risk): TraceHit {
	const c = t.crossing!;
	return {
		txid: c.txid,
		height: c.height,
		date: c.date,
		action: SMALL_TRANSFERS,
		relation: 'value',
		fromKey: c.fromKey,
		fromAddress: c.fromAddress,
		fromChain: c.fromChain,
		toKey: t.toKey,
		toAddress: t.toAddress,
		toChain: t.toChain,
		amount: `${t.count} transfers`,
		usd: t.usd,
		hop: t.hop,
		risk,
		originKey: t.originKey,
		originSource: t.originSource,
		...(t.originEntity ? { originEntity: t.originEntity } : {}),
		originRisk: t.originRisk,
		originCategory: t.originCategory
	};
}

/**
 * A dust flow that was also stored as a trace edge (the same transfer valued
 * above the dust limit on another read, e.g. at a different pool price) is
 * already in the edge sums: the ledger side leaves it out.
 */
const NOT_AN_EDGE = `NOT EXISTS (SELECT 1 FROM oz_trace_edges e WHERE e.txid = d.txid AND e.from_key = d.from_key AND e.to_key = d.to_key)`;

/** Per-(origin, recipient, hop) totals of recorded small transfers, each counted once. */
export async function dustTotals(sql: Sql): Promise<Array<{ originKey: string; toKey: string; hop: number; usd: number; count: number }>> {
	const r = await sql.query<{ origin_key: string; to_key: string; hop: number; usd: string | number; n: number }>(
		`SELECT d.origin_key, d.to_key, d.hop, sum(d.usd) AS usd, count(*)::int AS n
		 FROM oz_trace_dust_flows d
		 WHERE ${NOT_AN_EDGE}
		 GROUP BY d.origin_key, d.to_key, d.hop`
	);
	return r.rows.map((x) => ({ originKey: x.origin_key, toKey: x.to_key, hop: Number(x.hop), usd: Number(x.usd), count: Number(x.n) }));
}

/**
 * The small transfers of the given (origin, recipient, hop) groups, each
 * counted once and added up in chain order: `crossing` is the transfer with
 * which the running total first reached `dustUsd`.
 */
export async function loadDustGroups(
	sql: Sql,
	dustUsd: number,
	groups: Array<{ originKey: string; toKey: string; hop: number }>
): Promise<SmallTransferTotal[]> {
	const list = [...new Map(groups.map((g) => [groupId(g.originKey, g.toKey, g.hop), g])).values()];
	const out: SmallTransferTotal[] = [];
	for (let i = 0; i < list.length; i += 5000) {
		const chunk = list.slice(i, i + 5000);
		const r = await sql.query<{
			txid: string;
			from_key: string;
			from_address: string;
			from_chain: string;
			to_key: string;
			to_chain: string;
			to_address: string;
			action: string;
			height: string | number | null;
			ts: string | Date | null;
			usd: string | number;
			hop: number;
			origin_key: string;
			origin_source: string;
			origin_entity: string | null;
			origin_risk: Risk;
			origin_category: Category;
		}>(
			`SELECT d.txid, d.from_key, d.from_address, d.from_chain, d.to_key, d.to_chain, d.to_address, d.action, d.height, d.ts, d.usd,
			        d.hop, d.origin_key, d.origin_source, d.origin_entity, d.origin_risk, d.origin_category
			 FROM oz_trace_dust_flows d
			 JOIN unnest($1::text[], $2::text[], $3::int[]) AS g(origin_key, to_key, hop)
			   ON g.origin_key = d.origin_key AND g.to_key = d.to_key AND g.hop = d.hop
			 WHERE ${NOT_AN_EDGE}
			 ORDER BY d.origin_key, d.to_key, d.hop, d.height NULLS LAST, d.ts NULLS LAST, d.txid, d.from_key`,
			[chunk.map((g) => g.originKey), chunk.map((g) => g.toKey), chunk.map((g) => g.hop)]
		);
		let cur: SmallTransferTotal | undefined;
		let senders = new Set<string>();
		const flush = () => {
			if (cur) out.push({ ...cur, senders: [...senders] });
		};
		for (const row of r.rows) {
			const hop = Number(row.hop);
			const date = isoOf(row.ts) ?? new Date(0).toISOString();
			if (!cur || cur.originKey !== row.origin_key || cur.toKey !== row.to_key || cur.hop !== hop) {
				flush();
				senders = new Set();
				cur = {
					originKey: row.origin_key,
					toKey: row.to_key,
					toAddress: row.to_address,
					toChain: row.to_chain,
					hop,
					count: 0,
					usd: 0,
					senders: [],
					originRisk: row.origin_risk,
					originSource: row.origin_source,
					...(row.origin_entity ? { originEntity: row.origin_entity } : {}),
					originCategory: row.origin_category,
					firstDate: date,
					lastDate: date
				};
			}
			cur.count++;
			// micro-dollar rounding: a total of exactly the limit must not miss it by a float epsilon
			cur.usd = Math.round((cur.usd + Number(row.usd)) * 1e6) / 1e6;
			cur.lastDate = date;
			senders.add(row.from_address);
			// the strongest origin among the transfers is what decays (twins of a listing are one level lower)
			if (riskRank(row.origin_risk) > riskRank(cur.originRisk)) {
				cur.originRisk = row.origin_risk;
				cur.originSource = row.origin_source;
				cur.originCategory = row.origin_category;
				if (row.origin_entity) cur.originEntity = row.origin_entity;
				else delete cur.originEntity;
			}
			if (!cur.crossing && cur.usd >= dustUsd) {
				cur.crossing = {
					txid: row.txid,
					height: Number(row.height ?? 0),
					date,
					action: row.action,
					fromKey: row.from_key,
					fromAddress: row.from_address,
					fromChain: row.from_chain
				};
			}
		}
		flush();
	}
	return out;
}

const lowerRisk = (r: Risk): Risk => riskFromRank(Math.max(riskRank('low'), riskRank(r) - 1));

/**
 * The tracer's view of every flagged address: active listed entries of
 * origin categories (hop 0), their same-key twins (hop 0, one risk level
 * lower) and traced addresses (hop n, from their taint height on).
 */
export async function loadTraceIndex(sql: Sql, opts: { includeTwins?: boolean } = {}): Promise<Map<string, IndexEntry>> {
	const index = new Map<string, IndexEntry>();
	const suppressed = new Set(
		(await sql.query<{ key: string }>(`SELECT key FROM oz_overrides WHERE active AND action = 'suppress'`)).rows.map((r) => r.key)
	);
	const listed = await sql.query<{
		key: string;
		chain: string;
		address: string;
		risk: Risk;
		category: Category;
		source: string;
		entity: string | null;
		cluster: string | null;
		since: string | null;
		urgent: boolean | null;
	}>(
		`SELECT key, chain, address, risk, category, source, entity, meta->>'cluster' AS cluster, meta->>'since' AS since, (meta->>'urgent') = 'true' AS urgent
		 FROM oz_entries WHERE removed_at IS NULL`
	);
	const urgentKeys = new Set<string>();
	// Hack-cluster members and incident addresses count from the start of
	// their incident (meta.since): earlier activity cannot be the proceeds.
	// (Not from the recorded transfer: the expansion sees native transfers
	// only, so a member is often funded earlier through contracts or internal
	// transactions.) Cluster rows written before meta.since existed fall back
	// to their cluster's window.
	const incidentStart = new Map(CURATED.clusters.map((c) => [c.id, Math.floor(Date.parse(c.window.from) / 1000)]));
	const startOf = (r: { source: string; cluster: string | null; since: string | null }): number | undefined => {
		if (r.since) {
			const t = Math.floor(Date.parse(r.since) / 1000);
			if (Number.isFinite(t)) return t;
		}
		return r.source === 'cluster' && r.cluster ? incidentStart.get(r.cluster) : undefined;
	};
	const put = (e: IndexEntry) => {
		const cur = index.get(e.key);
		const better =
			!cur ||
			e.hop < cur.hop ||
			(e.hop === cur.hop &&
				(riskRank(e.originRisk) > riskRank(cur.originRisk) ||
					// same strength: an attribution without a start time covers more
					(riskRank(e.originRisk) === riskRank(cur.originRisk) && cur.sinceTime !== undefined && e.sinceTime === undefined)));
		if (better) index.set(e.key, e);
	};
	for (const r of listed.rows) {
		if (!isTraceOrigin(r.category)) continue;
		if (suppressed.has(r.key) && r.category !== 'sanctions' && r.category !== 'law_enforcement') continue;
		if (r.urgent === true) urgentKeys.add(r.key);
		const sinceTime = startOf(r);
		put({
			key: r.key,
			hop: 0,
			originRisk: r.risk,
			originKey: r.key,
			originSource: r.source,
			...(r.entity ? { originEntity: r.entity } : {}),
			originCategory: r.category,
			...(sinceTime && Number.isFinite(sinceTime) ? { sinceTime } : {})
		});
		if (opts.includeTwins !== false && TWIN_CATEGORIES.has(r.category)) {
			const p = parseForChain(r.address, r.chain);
			if (p) {
				for (const t of keyTwins(p)) {
					put({
						key: t.key,
						hop: 0,
						originRisk: lowerRisk(r.risk),
						originKey: r.key,
						originSource: r.source,
						...(r.entity ? { originEntity: r.entity } : {}),
						originCategory: r.category
					});
				}
			}
		}
	}
	const traced = await sql.query<{
		key: string;
		hop: number;
		origin_risk: Risk;
		origin_key: string;
		origin_source: string;
		origin_entity: string | null;
		origin_category: Category;
		first_height: string | number | null;
		service: boolean;
		suppressed: boolean;
	}>(`SELECT key, hop, origin_risk, origin_key, origin_source, origin_entity, origin_category, first_height, service, suppressed FROM oz_traced`);
	for (const t of traced.rows) {
		if (t.suppressed || suppressed.has(t.key)) continue;
		if (index.get(t.key)?.hop === 0) continue;
		put({
			key: t.key,
			hop: Number(t.hop),
			originRisk: t.origin_risk,
			originKey: t.origin_key,
			originSource: t.origin_source,
			...(t.origin_entity ? { originEntity: t.origin_entity } : {}),
			originCategory: t.origin_category,
			since: t.first_height === null ? undefined : Number(t.first_height),
			service: t.service
		});
	}
	// Incident path: a key listed urgently — and whatever was traced from it —
	// is checked first (pendingChecks), whichever entry describes it best.
	if (urgentKeys.size) {
		for (const e of index.values()) {
			if (urgentKeys.has(e.key) || urgentKeys.has(e.originKey)) e.urgent = true;
		}
	}
	return index;
}

/**
 * Midgard query strings for a key. Midgard's address filter is
 * case-sensitive: EVM *senders* are stored lower-case (as observed on
 * chain) while memo *destinations* keep the case the user typed (usually
 * EIP-55). Forward tracing only needs the actions an address *sends*, so the
 * canonical sender form is enough by default; `allForms` also returns the
 * destination spellings (EIP-55, `bitcoincash:` prefix) for full-history
 * lookups.
 */
export function queryForms(key: string, checksum: (a: string) => string, allForms = false): string[] {
	const k = splitKey(key);
	if (!k) return [];
	if (!allForms) return [k.address];
	if (k.namespace === 'evm') return [...new Set([k.address, checksum(k.address)])];
	if (k.namespace === 'bch') return [k.address, `bitcoincash:${k.address}`];
	return [k.address];
}

export interface CheckTask {
	key: string;
	fromHeight: number;
	hop: number;
	priority: number;
	/** Incident path: before everything else. */
	urgent: boolean;
	/** Within one priority: 0 traced, 1 attribution, 2 bulk list, 3 same-key twin. */
	seedClass: number;
}

/** Listings with many addresses and weaker attribution than a named incident or a sanctions designation. */
const BULK_CATEGORIES: ReadonlySet<string> = new Set(['stablecoin_freeze', 'phishing', 'scam']);

/**
 * Within one priority, what to read first: traced keys (proven THORChain
 * users), then attributions (sanctions, law enforcement, hack and exploit
 * attributions, maintainer flags), then bulk lists (issuer freezes,
 * phishing/scam lists), then same-key twins (speculative: the same key used
 * on a sibling chain).
 */
export function seedClass(e: IndexEntry): number {
	if (e.hop > 0) return 0;
	if (e.key !== e.originKey) return 3;
	return BULK_CATEGORIES.has(e.originCategory) ? 2 : 1;
}

/**
 * A key whose last check failed waits this long before it is tried again:
 * while Midgard fails (an outage, a rate limit), the backfill must not spend
 * every slice re-trying the same top-priority keys.
 */
export const ERROR_RETRY_MS = 30 * 60_000;

/**
 * Addresses whose Midgard history still has to be read: listed origins
 * (and twins) never checked, and traced addresses (below the hop limit, not
 * services) never checked since they were tainted. Incident-path keys
 * first, then highest risk (origin risk, less one per hop), then seedClass,
 * then key order. A key whose check failed is retried after ERROR_RETRY_MS.
 */
export async function pendingChecks(
	sql: Sql,
	index: Map<string, IndexEntry>,
	maxHops: number,
	limit = 1000,
	filter?: (key: string, e: IndexEntry) => boolean,
	now = Date.now()
): Promise<CheckTask[]> {
	const checked = new Map(
		(
			await sql.query<{ key: string; status: string; checked_height: string | number; checked_at: string | Date | null }>(
				`SELECT key, status, checked_height, checked_at FROM oz_trace_checked`
			)
		).rows.map((r) => [r.key, { status: r.status, height: Number(r.checked_height) || 0, at: r.checked_at ? new Date(r.checked_at).getTime() : 0 }])
	);
	const tasks: CheckTask[] = [];
	for (const e of index.values()) {
		if (e.service || e.hop >= maxHops) continue;
		if (filter && !filter(e.key, e)) continue;
		const ns = e.key.slice(0, e.key.indexOf(':'));
		if (!['evm', 'btc', 'ltc', 'doge', 'bch', 'tron', 'xrp', 'sol', 'thor', 'gaia'].includes(ns)) continue; // THORChain chains only
		const c = checked.get(e.key);
		if (c?.status === 'done' || c?.status === 'service') continue;
		if (c?.status === 'error' && now - c.at < ERROR_RETRY_MS && !e.urgent) continue;
		tasks.push({
			key: e.key,
			// incremental: never re-read what an earlier check already covered
			fromHeight: Math.max(e.since ?? 0, c?.height ?? 0),
			hop: e.hop,
			priority: riskRank(e.originRisk) * 10 - e.hop,
			urgent: !!e.urgent,
			seedClass: seedClass(e)
		});
	}
	tasks.sort(
		(a, b) =>
			Number(b.urgent) - Number(a.urgent) || b.priority - a.priority || a.seedClass - b.seedClass || a.key.localeCompare(b.key)
	);
	return tasks.slice(0, limit);
}

export async function markChecked(
	sql: Sql,
	key: string,
	status: 'done' | 'service' | 'error' | 'pending',
	info: { height?: number; actions?: number; error?: string } = {}
): Promise<void> {
	await sql.query(
		`INSERT INTO oz_trace_checked (key, checked_height, checked_at, actions, status, error) VALUES ($1,$2,now(),$3,$4,$5)
		 ON CONFLICT (key) DO UPDATE SET checked_height = GREATEST(oz_trace_checked.checked_height, EXCLUDED.checked_height),
		   checked_at = now(), actions = EXCLUDED.actions, status = EXCLUDED.status, error = EXCLUDED.error`,
		[key, info.height ?? 0, info.actions ?? 0, status, info.error?.slice(0, 500) ?? null]
	);
	if (status === 'service') await sql.query(`UPDATE oz_traced SET service = true WHERE key = $1`, [key]);
}

export async function getState<T>(sql: Sql, id: string): Promise<T | undefined> {
	const r = await sql.query<{ value: T }>(`SELECT value FROM oz_state WHERE id = $1`, [id]);
	return r.rows[0]?.value;
}

export async function setState(sql: Sql, id: string, value: unknown): Promise<void> {
	await sql.query(
		`INSERT INTO oz_state (id, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		[id, JSON.stringify(value)]
	);
}

// ---------------------------------------------------------------------------
// Payer links: THORChain accounts that paid a listed address
// ---------------------------------------------------------------------------

/**
 * Records THORChain accounts that signed a payment to a listed address
 * (tracer.ts PayerLink) as links of the user screening: the account becomes a
 * monitored user (`rujira_users`) and the listed address one of its L1 links
 * (`l1_addresses`), so screenUsers flags it one risk level below the listing
 * and the snapshot publishes it as a linked account — whoever the account is,
 * not only the ones the discovery already monitored. A link the discovery
 * tagged as an affiliate fee is a real link once the account is seen paying
 * the address itself. Replays are harmless.
 */
export async function recordPayerLinks(sql: Sql, links: PayerLink[]): Promise<number> {
	const unique = new Map<string, PayerLink>();
	for (const l of links) unique.set(`${l.thorAddress}\u0000${l.address}\u0000${l.chain}`, l);
	if (!unique.size) return 0;
	const rows = [...unique.values()];
	const users = [...new Set(rows.map((l) => l.thorAddress))];
	await batchInsert(sql, `INSERT INTO rujira_users (thor_address)`, 1, users.map((u) => [u]), `ON CONFLICT (thor_address) DO NOTHING`);
	await batchInsert(
		sql,
		`INSERT INTO l1_addresses (thor_address, l1_address, chain, pool)`,
		4,
		rows.map((l) => [l.thorAddress, l.address.startsWith('0x') ? l.address.toLowerCase() : l.address, l.chain, `${l.action}:${l.txid}`.slice(0, 120)]),
		`ON CONFLICT (thor_address, l1_address, chain) DO UPDATE SET affiliate = false`
	);
	return rows.length;
}

// ---------------------------------------------------------------------------
// Chain transaction history (contract flows), per flagged thor1 account
// ---------------------------------------------------------------------------

/**
 * Flagged thor1 accounts whose contract transactions still have to be read
 * (trace/chain.ts): like pendingChecks, for the chain source. Contracts do not
 * sign, so only accounts count; the same order (incident path, risk, seed class).
 */
export async function pendingChainChecks(
	sql: Sql,
	index: Map<string, IndexEntry>,
	maxHops: number,
	limit = 1000,
	filter?: (key: string, e: IndexEntry) => boolean,
	now = Date.now()
): Promise<CheckTask[]> {
	const checked = new Map(
		(
			await sql.query<{ key: string; status: string; checked_height: string | number; checked_at: string | Date | null }>(
				`SELECT key, status, checked_height, checked_at FROM oz_trace_chain_checked`
			)
		).rows.map((r) => [r.key, { status: r.status, height: Number(r.checked_height) || 0, at: r.checked_at ? new Date(r.checked_at).getTime() : 0 }])
	);
	const tasks: CheckTask[] = [];
	for (const e of index.values()) {
		if (e.service || e.hop >= maxHops) continue;
		if (!e.key.startsWith('thor:') || e.key.length - 5 > 50) continue;
		if (filter && !filter(e.key, e)) continue;
		const c = checked.get(e.key);
		if (c?.status === 'done' || c?.status === 'service') continue;
		if (c?.status === 'error' && now - c.at < ERROR_RETRY_MS && !e.urgent) continue;
		tasks.push({
			key: e.key,
			fromHeight: Math.max(e.since ?? 0, c?.height ?? 0),
			hop: e.hop,
			priority: riskRank(e.originRisk) * 10 - e.hop,
			urgent: !!e.urgent,
			seedClass: seedClass(e)
		});
	}
	tasks.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.priority - a.priority || a.seedClass - b.seedClass || a.key.localeCompare(b.key));
	return tasks.slice(0, limit);
}

export async function markChainChecked(
	sql: Sql,
	key: string,
	status: 'done' | 'service' | 'error' | 'pending',
	info: { height?: number; txs?: number; error?: string } = {}
): Promise<void> {
	await sql.query(
		`INSERT INTO oz_trace_chain_checked (key, checked_height, checked_at, txs, status, error) VALUES ($1,$2,now(),$3,$4,$5)
		 ON CONFLICT (key) DO UPDATE SET checked_height = GREATEST(oz_trace_chain_checked.checked_height, EXCLUDED.checked_height),
		   checked_at = now(), txs = EXCLUDED.txs, status = EXCLUDED.status, error = EXCLUDED.error`,
		[key, info.height ?? 0, info.txs ?? 0, status, info.error?.slice(0, 500) ?? null]
	);
	if (status === 'service') await sql.query(`UPDATE oz_traced SET service = true WHERE key = $1`, [key]);
}

// ---------------------------------------------------------------------------
// History backfill after a change in what the tracer reads
// ---------------------------------------------------------------------------

export interface BackfillPlan {
	/** Listed and traced keys with Midgard history whose check would be reset (read again from their taint height, or from the start for a listing). */
	midgardKeys: number;
	/** … of which listed. */
	listedKeys: number;
	/** Keys never checked, or checked without any history: nothing to reset (the follower covers what comes). */
	untouched: number;
	/** Flagged thor1 accounts whose contract transactions have not been read yet (no reset needed: the table is new). */
	chainKeys: number;
	/** One request per page of 50 actions is the floor; most listed keys have short histories. */
	requestsAtLeast: number;
}

/**
 * What re-reading the tracer's history would touch (read-only). Checks that
 * found no action are left alone: the real-time follower sees everything new,
 * so only a key with history can hold flows the old rules missed.
 */
export async function planTraceBackfill(sql: Sql): Promise<BackfillPlan> {
	const r = await sql.query<{ midgard: number; listed: number; untouched: number; requests: number }>(
		`SELECT count(*) FILTER (WHERE c.status <> 'service' AND c.checked_height > 0)::int AS midgard,
		        count(*) FILTER (WHERE c.status <> 'service' AND c.checked_height > 0 AND EXISTS (SELECT 1 FROM oz_entries e WHERE e.key = c.key AND e.removed_at IS NULL))::int AS listed,
		        count(*) FILTER (WHERE c.status = 'service' OR c.checked_height <= 0)::int AS untouched,
		        COALESCE(sum(GREATEST(1, ceil(c.actions / 50.0))) FILTER (WHERE c.status <> 'service' AND c.checked_height > 0), 0)::int AS requests
		 FROM oz_trace_checked c`
	);
	const chain = await sql.query<{ n: number }>(
		`SELECT count(*)::int AS n FROM oz_traced t
		 WHERE t.key LIKE 'thor:%' AND NOT t.suppressed AND NOT t.service
		   AND NOT EXISTS (SELECT 1 FROM oz_trace_chain_checked c WHERE c.key = t.key AND c.status IN ('done','service'))`
	);
	const listedThor = await sql.query<{ n: number }>(
		`SELECT count(DISTINCT e.key)::int AS n FROM oz_entries e
		 WHERE e.removed_at IS NULL AND e.key LIKE 'thor:%'
		   AND NOT EXISTS (SELECT 1 FROM oz_trace_chain_checked c WHERE c.key = e.key AND c.status IN ('done','service'))`
	);
	const row = r.rows[0];
	return {
		midgardKeys: Number(row?.midgard ?? 0),
		listedKeys: Number(row?.listed ?? 0),
		untouched: Number(row?.untouched ?? 0),
		chainKeys: Number(chain.rows[0]?.n ?? 0) + Number(listedThor.rows[0]?.n ?? 0),
		requestsAtLeast: Number(row?.requests ?? 0)
	};
}

/**
 * Sets every Midgard check that has history back to pending with its height at
 * zero, so the backfill reads those keys again (traced keys from their taint
 * height) under the current rules. Replays are harmless: edges, dust flows and
 * links are keyed, a stored edge only has its wording refreshed. Services stay
 * services. Returns how many checks were reset.
 */
export async function resetTraceChecks(sql: Sql): Promise<number> {
	const r = await sql.query<{ n: number }>(
		`WITH u AS (UPDATE oz_trace_checked SET status = 'pending', checked_height = 0, error = NULL
		   WHERE status <> 'service' AND checked_height > 0 RETURNING 1)
		 SELECT count(*)::int AS n FROM u`
	);
	return Number(r.rows[0]?.n ?? 0);
}

/**
 * The owner's switch for the history backfill: when `label` is not the one
 * already recorded in `oz_state` (`backfill:reset`), resets the checks once and
 * records it. The worker calls this at start with OZONE_BACKFILL_RESET, so the
 * reset happens once per label, however often the worker restarts.
 */
export async function maybeResetBackfill(sql: Sql, label: string | undefined, logger: Logger = silentLogger): Promise<{ applied: boolean; reset: number }> {
	if (!label) return { applied: false, reset: 0 };
	const done = await getState<{ label?: string }>(sql, 'backfill:reset');
	if (done?.label === label) return { applied: false, reset: 0 };
	const reset = await resetTraceChecks(sql);
	await setState(sql, 'backfill:reset', { label, at: new Date().toISOString(), reset });
	logger.info(`backfill "${label}": ${reset} trace check(s) reset; the backfill job reads their history again`);
	return { applied: true, reset };
}
