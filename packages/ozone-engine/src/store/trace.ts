/**
 * Trace persistence: edges (every flow that flagged something), the best
 * reason per traced address, the tracer's index and Midgard progress.
 */
import { keyTwins, parseForChain, riskFromRank, riskRank, splitKey, type Category, type Risk } from '../../../ozone-client/src/index.js';
import { isTraceOrigin, describeHit, type IndexEntry, type TraceHit } from '../trace/tracer.js';
import type { Sql } from '../types.js';
import { batchInsert } from './db.js';

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
		`ON CONFLICT (txid, from_key, to_key) DO NOTHING`
	);
	// best reason per target: lowest hop, then highest risk, then largest value
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
	await batchInsert(
		sql,
		`INSERT INTO oz_traced (key, chain, address, hop, risk, usd, origin_key, origin_source, origin_entity, origin_risk, origin_category,
			first_txid, first_height, first_ts, edges, updated_at)`,
		16,
		[...best.values()].map((h) => [
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
	const keys = [...best.keys()];
	for (let i = 0; i < keys.length; i += 1000) {
		await sql.query(
			`UPDATE oz_traced t SET edges = (SELECT count(*) FROM oz_trace_edges e WHERE e.to_key = t.key) WHERE t.key = ANY($1::text[])`,
			[keys.slice(i, i + 1000)]
		);
	}
	return { edges: hits.length, traced: best.size };
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
	const listed = await sql.query<{ key: string; chain: string; address: string; risk: Risk; category: Category; source: string; entity: string | null }>(
		`SELECT key, chain, address, risk, category, source, entity FROM oz_entries WHERE removed_at IS NULL`
	);
	const put = (e: IndexEntry) => {
		const cur = index.get(e.key);
		if (!cur || e.hop < cur.hop || (e.hop === cur.hop && riskRank(e.originRisk) > riskRank(cur.originRisk))) index.set(e.key, e);
	};
	for (const r of listed.rows) {
		if (!isTraceOrigin(r.category)) continue;
		if (suppressed.has(r.key) && r.category !== 'sanctions' && r.category !== 'law_enforcement') continue;
		put({
			key: r.key,
			hop: 0,
			originRisk: r.risk,
			originKey: r.key,
			originSource: r.source,
			...(r.entity ? { originEntity: r.entity } : {}),
			originCategory: r.category
		});
		if (opts.includeTwins !== false) {
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
	return index;
}

/** Midgard query strings for a key (EVM: lower-case and EIP-55; BCH: with and without prefix). */
export function queryForms(key: string, checksum: (a: string) => string): string[] {
	const k = splitKey(key);
	if (!k) return [];
	if (k.namespace === 'evm') return [...new Set([k.address, checksum(k.address)])];
	if (k.namespace === 'bch') return [k.address, `bitcoincash:${k.address}`];
	return [k.address];
}

export interface CheckTask {
	key: string;
	fromHeight: number;
	hop: number;
	priority: number;
}

/**
 * Addresses whose Midgard history still has to be read: listed origins
 * (and twins) never checked, and traced addresses (below the hop limit, not
 * services) never checked since they were tainted. Highest risk first.
 */
export async function pendingChecks(sql: Sql, index: Map<string, IndexEntry>, maxHops: number, limit = 1000): Promise<CheckTask[]> {
	const checked = new Map(
		(await sql.query<{ key: string; status: string; checked_height: string | number }>(`SELECT key, status, checked_height FROM oz_trace_checked`)).rows.map(
			(r) => [r.key, { status: r.status, height: Number(r.checked_height) || 0 }]
		)
	);
	const tasks: CheckTask[] = [];
	for (const e of index.values()) {
		if (e.service || e.hop >= maxHops) continue;
		const ns = e.key.slice(0, e.key.indexOf(':'));
		if (!['evm', 'btc', 'ltc', 'doge', 'bch', 'tron', 'xrp', 'sol', 'thor', 'gaia'].includes(ns)) continue; // THORChain chains only
		const c = checked.get(e.key);
		if (c?.status === 'done' || c?.status === 'service') continue;
		tasks.push({
			key: e.key,
			// incremental: never re-read what an earlier check already covered
			fromHeight: Math.max(e.since ?? 0, c?.height ?? 0),
			hop: e.hop,
			priority: riskRank(e.originRisk) * 10 - e.hop
		});
	}
	tasks.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
	return tasks.slice(0, limit);
}

export async function markChecked(
	sql: Sql,
	key: string,
	status: 'done' | 'service' | 'error',
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
