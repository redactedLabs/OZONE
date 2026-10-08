/**
 * Affiliate fee collectors: what is known about them, and pruning what the
 * tracer recorded through them under the earlier rules.
 *
 * An interface (a wallet, a swap front end) registers a THORName, names it as
 * the affiliate in its users' swap memos, and collects a fee on every swap at
 * the THORName's THOR address. That address, the THORName and the interface's
 * other THORNames and aliases are shared infrastructure: a hacker's swap
 * through the interface pays them a fee, which says nothing about who owns
 * what. On 2026-10-07 nine of the ten flagged thor1 addresses were exactly
 * that: the fee collectors and owners behind the affiliate THORNames
 * `naswap`, `w1`/`wr` and `xdf`/`ct`, flagged through THORName links and a
 * fee read from a refund action (trace/flows.ts).
 *
 * What counts as a collector:
 * - the real-time follower saw Midgard mark outputs to it as affiliate fees
 *   in at least COLLECTOR_RECEIPTS swaps; or
 * - its own Midgard history (classifyAffiliates) shows at least
 *   COLLECTOR_RECEIPTS affiliate fees, and they are at least a fifth of what
 *   it does.
 * A THORName is an affiliate name when swappers named it as their affiliate
 * at least COLLECTOR_RECEIPTS times, or when it points (or pointed) at a
 * collector.
 */
import type { Category, Risk } from '../../../ozone-client/src/index.js';
import { affiliateObservations, type AffiliateSet } from '../trace/flows.js';
import type { MidgardAction, MidgardLike } from '../trace/midgard.js';
import type { TraceHit } from '../trace/tracer.js';
import type { Logger, Sql } from '../types.js';
import { silentLogger } from '../types.js';
import { QuotaDenied } from '../util/quota.js';
import { batchInsert } from './db.js';
import { getState, loadTraceIndex, recordHits, setState } from './trace.js';

/** Affiliate fees after which an address counts as a fee collector. */
export const COLLECTOR_RECEIPTS = 5;
/** Share of an address's own actions that must be affiliate fees (classification by history). */
export const COLLECTOR_SHARE = 0.2;
/** A classification is repeated after this long. */
export const CLASSIFY_AGAIN_MS = 7 * 24 * 3600_000;

export interface Affiliates extends AffiliateSet {
	collectors: Set<string>;
	names: Set<string>;
}

export function affiliateSet(collectors: Iterable<string>, names: Iterable<string>): Affiliates {
	const c = new Set([...collectors].map((a) => a.toLowerCase()));
	const n = new Set([...names].map((a) => a.toLowerCase()));
	return { collectors: c, names: n, isCollector: (a) => c.has(a.toLowerCase()), isName: (x) => n.has(x.toLowerCase()) };
}

export const NO_AFFILIATES: Affiliates = affiliateSet([], []);

/** What the actions say about affiliates (the real-time follower reads each action once). */
export async function recordAffiliateObservations(sql: Sql, actions: MidgardAction[]): Promise<{ collectors: number; names: number }> {
	const receipts = new Map<string, { n: number; first: number; last: number; names: Set<string> }>();
	const names = new Map<string, number>();
	for (const a of actions) {
		const o = affiliateObservations(a);
		const h = Number(a.height) || 0;
		for (const c of o.collectors) {
			const r = receipts.get(c) ?? { n: 0, first: h, last: h, names: new Set<string>() };
			r.n++;
			r.first = Math.min(r.first, h);
			r.last = Math.max(r.last, h);
			// one collector and one name in the same swap: that name pays this collector
			if (o.collectors.length === 1 && o.names.length === 1) r.names.add(o.names[0]);
			receipts.set(c, r);
		}
		for (const n of o.names) names.set(n, (names.get(n) ?? 0) + 1);
	}
	if (receipts.size) {
		await batchInsert(
			sql,
			`INSERT INTO oz_affiliates (address, receipts, names, first_height, last_height)`,
			5,
			[...receipts].map(([address, r]) => [address, r.n, [...r.names], r.first, r.last]),
			`ON CONFLICT (address) DO UPDATE SET receipts = oz_affiliates.receipts + EXCLUDED.receipts,
			   names = ARRAY(SELECT DISTINCT unnest(oz_affiliates.names || EXCLUDED.names)),
			   first_height = LEAST(oz_affiliates.first_height, EXCLUDED.first_height),
			   last_height = GREATEST(oz_affiliates.last_height, EXCLUDED.last_height), updated_at = now()`
		);
	}
	if (names.size) {
		await batchInsert(
			sql,
			`INSERT INTO oz_affiliate_names (name, uses)`,
			2,
			[...names].map(([n, uses]) => [n, uses]),
			`ON CONFLICT (name) DO UPDATE SET uses = oz_affiliate_names.uses + EXCLUDED.uses, updated_at = now()`
		);
	}
	return { collectors: receipts.size, names: names.size };
}

/** The collectors and affiliate names known so far (empty before migration 0007). */
export async function loadAffiliates(sql: Sql): Promise<Affiliates> {
	try {
		const c = await sql.query<{ address: string; names: string[] | null }>(
			`SELECT address, names FROM oz_affiliates
			 WHERE receipts >= $1::int OR (affiliate_actions >= $1::int AND affiliate_actions >= $2::float8 * GREATEST(actions_read, 1))`,
			[COLLECTOR_RECEIPTS, COLLECTOR_SHARE]
		);
		const n = await sql.query<{ name: string }>(`SELECT name FROM oz_affiliate_names WHERE uses >= $1::int`, [COLLECTOR_RECEIPTS]);
		const names = new Set(n.rows.map((r) => r.name));
		for (const r of c.rows) for (const x of r.names ?? []) names.add(x);
		return affiliateSet(
			c.rows.map((r) => r.address),
			names
		);
	} catch {
		return NO_AFFILIATES;
	}
}

/**
 * Reads the first page of each candidate's own Midgard history and counts
 * the affiliate fees it received. Candidates: traced thor1 accounts and the
 * thor1 ends of THORName links, not classified in the last CLASSIFY_AGAIN_MS.
 */
export async function classifyAffiliates(
	sql: Sql,
	midgard: MidgardLike,
	opts: { logger?: Logger; limit?: number; now?: number } = {}
): Promise<{ checked: number; collectors: number; skipped?: string }> {
	const log = opts.logger ?? silentLogger;
	const now = opts.now ?? Date.now();
	const rows = await sql.query<{ address: string }>(
		`WITH c AS (
		   SELECT substr(key, 6) AS address FROM oz_traced WHERE key LIKE 'thor:thor1%' AND NOT suppressed
		   UNION SELECT substr(to_key, 6) FROM oz_trace_edges WHERE relation = 'thorname' AND to_key LIKE 'thor:thor1%'
		   UNION SELECT substr(from_key, 6) FROM oz_trace_edges WHERE relation = 'thorname' AND from_key LIKE 'thor:thor1%'
		 )
		 SELECT c.address FROM c LEFT JOIN oz_affiliates a ON a.address = c.address
		 WHERE length(c.address) <= 50 AND (a.checked_at IS NULL OR a.checked_at < $1)
		 ORDER BY c.address LIMIT $2`,
		[new Date(now - CLASSIFY_AGAIN_MS), opts.limit ?? 200]
	);
	let checked = 0;
	let collectors = 0;
	for (const { address } of rows.rows) {
		let page;
		try {
			page = await midgard.actions({ address, limit: 50 });
		} catch (e) {
			if (e instanceof QuotaDenied) return { checked, collectors, skipped: e.message };
			log.warn(`affiliates: ${address} not classified: ${(e as Error).message}`);
			continue;
		}
		const fees = page.actions.filter((a) => a.out.some((o) => o.affiliate && o.address === address)).length;
		const read = page.actions.length;
		await sql.query(
			`INSERT INTO oz_affiliates (address, actions_read, affiliate_actions, checked_at) VALUES ($1,$2,$3,$4)
			 ON CONFLICT (address) DO UPDATE SET actions_read = EXCLUDED.actions_read, affiliate_actions = EXCLUDED.affiliate_actions,
			   checked_at = EXCLUDED.checked_at, updated_at = now()`,
			[address, read, fees, new Date(now)]
		);
		checked++;
		if (fees >= COLLECTOR_RECEIPTS && fees >= COLLECTOR_SHARE * Math.max(1, read)) {
			collectors++;
			log.info(`affiliates: ${address} is a fee collector (${fees} of its last ${read} actions are affiliate fees)`);
		}
	}
	return { checked, collectors };
}

// ---------------------------------------------------------------------------
// Pruning what earlier rules recorded
// ---------------------------------------------------------------------------

export interface PruneResult {
	/** Edges removed by a rule (before the cascade). */
	ruleEdges: { refund: number; infrastructure: number };
	/** Traced keys that lost every path to a listing through those edges (removed with their own outflows). */
	orphanedKeys: number;
	/** Edges removed in all (rules + cascade). */
	edges: number;
	/** Traced keys whose best reason was rebuilt from the edges that remain. */
	rebuilt: number;
	keys: string[];
}

interface EdgeRow {
	txid: string;
	from_key: string;
	to_key: string;
	from_address: string;
	from_chain: string;
	to_chain: string;
	to_address: string;
	action: string;
	relation: string;
	height: string | number | null;
	ts: string | Date | null;
	amount: string | null;
	usd: string | number | null;
	hop: number;
	risk: Risk;
	origin_key: string;
	origin_source: string;
	origin_entity: string | null;
	origin_risk: Risk;
	origin_category: Category;
}

/** `"285.5366 THOR.RUNE"` → `THOR`. */
const amountChain = (amount: string | null): string | undefined => /\s([A-Z0-9]+)[.~/-]/.exec(` ${amount ?? ''}`.toUpperCase())?.[1];
/** `"THORName wr"` → `wr`. */
const thornameOf = (amount: string | null): string | undefined => /^THORName\s+(\S+)/i.exec(amount ?? '')?.[1]?.toLowerCase();

/**
 * Removes what the current rules no longer read from the stored trace graph,
 * with everything that hung only on it:
 *
 * - `refund` edges that paid an asset other than the one sent (the paired
 *   swap's outputs, see trace/flows.ts), and refund edges to a collector;
 * - THORName and LP links to or from a collector, and THORName links of an
 *   affiliate name (or of a name that points at a collector);
 * - then every traced key that, without those edges, has no path left from a
 *   listing (through edges and small-transfer flows), with its own edges,
 *   small transfers, checks and trace row. Keys that were already without a
 *   path before (delisted origins, maintainer suppressions) are left as they
 *   are: only what these rules removed is followed.
 *
 * Traced keys that keep a path but lost their best edge get their trace row
 * rebuilt from the edges that remain. The removed keys are recorded in
 * `oz_state` `trace:prune` for review. Idempotent.
 */
export async function pruneTraceGraph(sql: Sql, affiliates: Affiliates, opts: { logger?: Logger; label?: string } = {}): Promise<PruneResult> {
	const log = opts.logger ?? silentLogger;
	const edges = (
		await sql.query<EdgeRow>(
			`SELECT txid, from_key, to_key, from_address, from_chain, to_chain, to_address, action, relation, height, ts, amount, usd, hop, risk,
			        origin_key, origin_source, origin_entity, origin_risk, origin_category FROM oz_trace_edges`
		)
	).rows;
	const keyOf = (address: string) => `thor:${address.toLowerCase()}`;
	const collectorKeys = new Set([...affiliates.collectors].map(keyOf));
	// a THORName that points at a collector is the interface's own
	const names = new Set(affiliates.names);
	for (const e of edges) {
		if (e.relation !== 'thorname') continue;
		const n = thornameOf(e.amount);
		if (n && (collectorKeys.has(e.from_key) || collectorKeys.has(e.to_key))) names.add(n);
	}
	const id = (e: EdgeRow) => `${e.txid}\u0000${e.from_key}\u0000${e.to_key}`;
	const ruleDrop = new Set<string>();
	const counts = { refund: 0, infrastructure: 0 };
	for (const e of edges) {
		if (e.action === 'refund' && e.relation === 'value') {
			const outChain = amountChain(e.amount);
			if ((outChain && outChain !== e.from_chain.toUpperCase()) || collectorKeys.has(e.to_key)) {
				ruleDrop.add(id(e));
				counts.refund++;
			}
			continue;
		}
		if (e.relation === 'thorname' || e.relation === 'lp_pair') {
			const n = e.relation === 'thorname' ? thornameOf(e.amount) : undefined;
			if (collectorKeys.has(e.from_key) || collectorKeys.has(e.to_key) || (n && names.has(n))) {
				ruleDrop.add(id(e));
				counts.infrastructure++;
			}
		}
	}
	const empty: PruneResult = { ruleEdges: counts, orphanedKeys: 0, edges: 0, rebuilt: 0, keys: [] };
	if (!ruleDrop.size) return empty;

	// paths from listings, before and after the rule removals
	const index = await loadTraceIndex(sql);
	const roots = [...index.values()].filter((e) => e.hop === 0).map((e) => e.key);
	const dust = (await sql.query<{ from_key: string; to_key: string }>(`SELECT DISTINCT from_key, to_key FROM oz_trace_dust_flows`)).rows;
	const reach = (without: Set<string>): Set<string> => {
		const out = new Map<string, string[]>();
		const add = (f: string, t: string) => {
			const l = out.get(f);
			if (l) l.push(t);
			else out.set(f, [t]);
		};
		for (const e of edges) if (!without.has(id(e))) add(e.from_key, e.to_key);
		for (const d of dust) add(d.from_key, d.to_key);
		const seen = new Set(roots);
		const queue = [...roots];
		while (queue.length) {
			const k = queue.pop()!;
			for (const t of out.get(k) ?? []) {
				if (!seen.has(t)) {
					seen.add(t);
					queue.push(t);
				}
			}
		}
		return seen;
	};
	const before = reach(new Set());
	const after = reach(ruleDrop);
	const rootSet = new Set(roots);
	// (1) keys a path from a listing reached only through the removed edges
	const orphanSet = new Set([...before].filter((k) => !after.has(k) && !rootSet.has(k)));
	// (2) keys whose remaining inflow is gone with them: every edge into them was removed or comes
	// from an orphan, and no small transfer from a key that stays reaches them. This also ends
	// support that was circular (two THORName aliases of one interface naming each other).
	const inbound = new Map<string, Array<{ from: string; dropped: boolean }>>();
	for (const e of edges) {
		const l = inbound.get(e.to_key) ?? [];
		l.push({ from: e.from_key, dropped: ruleDrop.has(id(e)) });
		inbound.set(e.to_key, l);
	}
	const dustIn = new Map<string, string[]>();
	for (const d of dust) dustIn.set(d.to_key, [...(dustIn.get(d.to_key) ?? []), d.from_key]);
	const outbound = new Map<string, string[]>();
	for (const e of edges) outbound.set(e.from_key, [...(outbound.get(e.from_key) ?? []), e.to_key]);
	const queue = [...new Set([...edges.filter((e) => ruleDrop.has(id(e))).map((e) => e.to_key), ...orphanSet])];
	while (queue.length) {
		const k = queue.pop()!;
		if (!orphanSet.has(k)) {
			if (rootSet.has(k)) continue;
			const kept = (inbound.get(k) ?? []).some((x) => !x.dropped && !orphanSet.has(x.from)) || (dustIn.get(k) ?? []).some((f) => !orphanSet.has(f));
			if (kept) continue;
			orphanSet.add(k);
		}
		for (const t of outbound.get(k) ?? []) if (!orphanSet.has(t)) queue.push(t);
	}
	const orphans = [...orphanSet];
	const drop = edges.filter((e) => ruleDrop.has(id(e)) || orphanSet.has(e.from_key) || orphanSet.has(e.to_key));
	for (let i = 0; i < drop.length; i += 500) {
		const chunk = drop.slice(i, i + 500);
		await sql.query(
			`DELETE FROM oz_trace_edges e USING unnest($1::text[], $2::text[], $3::text[]) AS d(txid, from_key, to_key)
			 WHERE e.txid = d.txid AND e.from_key = d.from_key AND e.to_key = d.to_key`,
			[chunk.map((e) => e.txid), chunk.map((e) => e.from_key), chunk.map((e) => e.to_key)]
		);
	}
	if (orphans.length) {
		await sql.query(`DELETE FROM oz_trace_dust_flows WHERE from_key = ANY($1::text[]) OR to_key = ANY($1::text[])`, [orphans]);
		await sql.query(`DELETE FROM oz_traced WHERE key = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM oz_entries e WHERE e.key = oz_traced.key AND e.removed_at IS NULL)`, [orphans]);
		await sql.query(`DELETE FROM oz_trace_checked WHERE key = ANY($1::text[])`, [orphans]);
		await sql.query(`DELETE FROM oz_trace_chain_checked WHERE key = ANY($1::text[])`, [orphans]).catch(() => undefined);
	}
	// keys that keep a path but lost edges: rebuild their trace row from what remains
	const touched = [...new Set(drop.map((e) => e.to_key))].filter((k) => !orphanSet.has(k) && !rootSet.has(k));
	let rebuilt = 0;
	if (touched.length) {
		const remaining = (
			await sql.query<EdgeRow>(
				`SELECT txid, from_key, to_key, from_address, from_chain, to_chain, to_address, action, relation, height, ts, amount, usd, hop, risk,
				        origin_key, origin_source, origin_entity, origin_risk, origin_category FROM oz_trace_edges WHERE to_key = ANY($1::text[])`,
				[touched]
			)
		).rows;
		const hits: TraceHit[] = remaining.map((e) => ({
			txid: e.txid,
			height: Number(e.height ?? 0),
			date: new Date(e.ts ?? 0).toISOString(),
			action: e.action,
			relation: e.relation as TraceHit['relation'],
			fromKey: e.from_key,
			fromAddress: e.from_address,
			fromChain: e.from_chain,
			toKey: e.to_key,
			toAddress: e.to_address,
			toChain: e.to_chain,
			...(e.amount ? { amount: e.amount } : {}),
			...(e.usd !== null ? { usd: Number(e.usd) } : {}),
			hop: Number(e.hop),
			risk: e.risk,
			originKey: e.origin_key,
			originSource: e.origin_source,
			...(e.origin_entity ? { originEntity: e.origin_entity } : {}),
			originRisk: e.origin_risk,
			originCategory: e.origin_category
		}));
		const withEdges = new Set(hits.map((h) => h.toKey));
		// a key kept only by small transfers keeps its row (recordDustFlows owns it)
		const replace = touched.filter((k) => withEdges.has(k));
		if (replace.length) {
			await sql.query(`DELETE FROM oz_traced WHERE key = ANY($1::text[])`, [replace]);
			await recordHits(sql, hits);
			rebuilt = replace.length;
		}
	}
	const result: PruneResult = { ruleEdges: counts, orphanedKeys: orphans.length, edges: drop.length, rebuilt, keys: orphans.slice(0, 500) };
	const history = (await getState<Array<PruneResult & { at: string; label?: string }>>(sql, 'trace:prune').catch(() => undefined)) ?? [];
	await setState(sql, 'trace:prune', [...history.slice(-9), { ...result, at: new Date().toISOString(), ...(opts.label ? { label: opts.label } : {}) }]);
	log.info(
		`trace prune: ${counts.refund} refund and ${counts.infrastructure} affiliate-infrastructure edge(s) removed; ${orphans.length} traced key(s) without another path removed; ${rebuilt} rebuilt`
	);
	return result;
}
