/**
 * Runs the cluster expansions that are due and rebuilds the `cluster`
 * source from what every cluster found.
 *
 * - Each cluster (one incident on one chain, see cluster/specs.ts) is
 *   planned: adopt, full, resume, incremental or skip (planRun).
 * - Chains run as parallel lanes (their explorer hosts are separate);
 *   inside a lane one cluster at a time, THORChain-laundered and maintainer
 *   incidents first. All lanes share one request budget per run.
 * - Results are kept per cluster in oz_cluster_members: a complete full run
 *   replaces its cluster's members, anything else adds to them, so a run cut
 *   short by a budget never delists what an earlier run found. The run is
 *   recorded in oz_cluster_runs with its stop reason and the frontier the
 *   next run resumes from.
 * - The `cluster` source is then the union of every cluster still defined:
 *   an incident removed from the dataset (or a maintainer incident whose
 *   flags were deactivated) delists its members.
 *
 * Nothing is capped silently: every cluster that was cut short, not run
 * (budget spent, no explorer for its chain, no seeds) or skipped as
 * complete is in the result and the log.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import { isEvmChain, type ExplorerEnv } from '../explorers/evm.js';
import { isUtxoChain } from '../explorers/esplora.js';
import { thorchainInbound } from '../explorers/thornode.js';
import { l1TxUrl } from '../explorers/links.js';
import { expandEvm } from '../evm/expand.js';
import { expandUtxo } from '../utxo/expand.js';
import type { ClusterSpec } from '../sources/curated-data.js';
import type { SourceContext } from '../sources/registry.js';
import { applySourceResult, recordSourceError, type ApplyStats } from '../store/entries.js';
import { batchInsert, withTransaction } from '../store/db.js';
import { emptyResult, silentLogger, type ListEntry, type Logger, type ParseResult, type Sql } from '../types.js';
import { curatedClusterSpecs, manualClusterSpecs, planRun, specHash, type ClusterRunRow, type RunPlan } from './specs.js';
import type { ClusterMember, ExpandResult } from './types.js';

export const CLUSTER_SOURCE = {
	id: 'cluster',
	name: 'Hack cluster expansion',
	kind: 'derived',
	url: 'https://ozone.redacted.gg/methodology#clusters',
	maxDropRatio: 0.5
};

/** Re-run period of clusters whose laundering window is still open. */
export const CLUSTER_PERIOD_MS = 7 * 24 * 3600_000;

const UNIT: Record<string, string> = { ETH: 'ETH', ARB: 'ETH', OP: 'ETH', BASE: 'ETH', POL: 'POL', AVAX: 'AVAX', BSC: 'BNB', GNOSIS: 'xDAI', BTC: 'BTC', LTC: 'LTC' };

export interface ClusterRunSummary {
	cluster: string;
	incident: string;
	chain: string;
	plan: RunPlan['mode'];
	/** complete | partial | skipped | adopted */
	status: string;
	members: number;
	newMembers: number;
	requests: number;
	stop?: string;
	/** Nodes left for the next run. */
	frontierLeft?: number;
	why?: string;
}

export interface ClusterRunOptions extends SourceContext {
	/** Explorer requests this run may spend across all clusters (default 15,000). */
	maxRequests?: number;
	/** Stop every lane (resumably) after this long. */
	timeBudgetMs?: number;
	/** Only these clusters (e.g. the incident path's urgent ones). */
	only?: (spec: ClusterSpec) => boolean;
	/** Run even when not due (a full run unless there is a resume point). */
	force?: boolean;
	periodMs?: number;
	env?: ExplorerEnv;
	now?: Date;
	/** Override the cluster list (tests). */
	specs?: ClusterSpec[];
}

export interface ClusterRunResult {
	source: 'cluster';
	ok: boolean;
	stats?: ApplyStats;
	error?: string;
	durationMs: number;
	runs: ClusterRunSummary[];
}

/** Seeds of a spec: its own addresses plus the listed addresses of its seed sources. */
async function specSeeds(sql: Sql, spec: ClusterSpec): Promise<string[]> {
	const seeds = [...(spec.seeds ?? [])];
	if (spec.seedSources?.length) {
		const ns = isEvmChain(spec.chain) ? 'evm' : spec.chain.toLowerCase();
		const r = await sql.query<{ address: string; source: string; entity: string | null }>(
			`SELECT address, source, entity FROM oz_entries WHERE removed_at IS NULL AND key LIKE $2 AND source = ANY($1::text[])`,
			[spec.seedSources, `${ns}:%`]
		);
		for (const row of r.rows) {
			if (row.source === 'ethlabels' && spec.seedLabelFilter && !(row.entity ?? '').includes(spec.seedLabelFilter)) continue;
			seeds.push(row.address);
		}
	}
	return [...new Set(seeds.map((s) => (isEvmChain(spec.chain) ? s.toLowerCase() : s)))];
}

async function loadRuns(sql: Sql): Promise<Map<string, ClusterRunRow>> {
	const r = await sql.query<ClusterRunRow>(`SELECT cluster, ran_at, complete, params_hash, window_to, seeds, service_list, frontier FROM oz_cluster_runs`);
	return new Map(r.rows.map((row) => [row.cluster, row]));
}

async function memberAddresses(sql: Sql, cluster: string): Promise<string[]> {
	return (await sql.query<{ address: string }>(`SELECT address FROM oz_cluster_members WHERE cluster = $1`, [cluster])).rows.map((r) => r.address);
}

async function saveMembers(sql: Sql, spec: ClusterSpec, members: ClusterMember[], replace: boolean, services: string[]): Promise<void> {
	await withTransaction(sql, async (tx) => {
		if (replace) await tx.query(`DELETE FROM oz_cluster_members WHERE cluster = $1`, [spec.id]);
		if (services.length) await tx.query(`DELETE FROM oz_cluster_members WHERE cluster = $1 AND address = ANY($2::text[])`, [spec.id, services]);
		if (!members.length) return;
		await batchInsert(
			tx,
			`INSERT INTO oz_cluster_members (cluster, incident, key, chain, address, depth, from_address, value, tx, ts)`,
			10,
			members.map((m) => [spec.id, spec.incident, m.key, m.chain, m.address, m.depth, m.from, m.value, m.tx, m.time ? new Date(m.time * 1000) : null]),
			`ON CONFLICT (cluster, key) DO UPDATE SET depth = LEAST(oz_cluster_members.depth, EXCLUDED.depth),
				from_address = CASE WHEN EXCLUDED.depth < oz_cluster_members.depth THEN EXCLUDED.from_address ELSE oz_cluster_members.from_address END,
				value = CASE WHEN EXCLUDED.depth < oz_cluster_members.depth THEN EXCLUDED.value ELSE oz_cluster_members.value END,
				tx = CASE WHEN EXCLUDED.depth < oz_cluster_members.depth THEN EXCLUDED.tx ELSE oz_cluster_members.tx END,
				ts = CASE WHEN EXCLUDED.depth < oz_cluster_members.depth THEN EXCLUDED.ts ELSE oz_cluster_members.ts END`
		);
	});
}

async function saveRun(
	sql: Sql,
	spec: ClusterSpec,
	seeds: string[],
	complete: boolean,
	r: Omit<Partial<ExpandResult>, 'stop'> & { stop?: string },
	members: number,
	services: string[]
): Promise<void> {
	await sql.query(
		`INSERT INTO oz_cluster_runs (cluster, incident, chain, ran_at, complete, params_hash, window_from, window_to, requests, members, services, stop, seeds, service_list, frontier, skipped, error)
		 VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		 ON CONFLICT (cluster) DO UPDATE SET incident = EXCLUDED.incident, chain = EXCLUDED.chain, ran_at = EXCLUDED.ran_at, complete = EXCLUDED.complete,
		   params_hash = EXCLUDED.params_hash, window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to, requests = EXCLUDED.requests,
		   members = EXCLUDED.members, services = EXCLUDED.services, stop = EXCLUDED.stop, seeds = EXCLUDED.seeds, service_list = EXCLUDED.service_list,
		   frontier = EXCLUDED.frontier, skipped = EXCLUDED.skipped, error = EXCLUDED.error`,
		[
			spec.id,
			spec.incident,
			spec.chain,
			complete,
			specHash(spec),
			new Date(spec.window.from),
			new Date(spec.window.to),
			r.requests ?? 0,
			members,
			services.length,
			r.stop ?? null,
			JSON.stringify(seeds),
			JSON.stringify(services),
			JSON.stringify(r.frontier ?? []),
			JSON.stringify(r.skipped ?? {}),
			r.error?.slice(0, 500) ?? null
		]
	);
}

/** Risk by depth: the first two layers are the launderer's own fan-out. */
export function clusterRisk(spec: Pick<ClusterSpec, 'risk'>, depth: number): 'high' | 'medium' | 'low' {
	if (depth <= 2) return spec.risk === 'high' || spec.risk === 'severe' ? 'high' : 'medium';
	if (depth === 3) return 'medium';
	return 'low';
}

interface MemberRow {
	cluster: string;
	key: string;
	chain: string;
	address: string;
	depth: number;
	from_address: string | null;
	value: number | null;
	tx: string | null;
	ts: string | Date | null;
}

/**
 * The `cluster` source: every member of every defined cluster, one entry per
 * address (the closest cluster wins), each naming its incident.
 */
export async function clusterSourceResult(sql: Sql, specs: ClusterSpec[]): Promise<ParseResult> {
	const byId = new Map(specs.map((s) => [s.id, s]));
	const rows = (
		await sql.query<MemberRow>(
			`SELECT cluster, key, chain, address, depth, from_address, value, tx, ts FROM oz_cluster_members WHERE cluster = ANY($1::text[]) ORDER BY key, depth, cluster`,
			[[...byId.keys()]]
		)
	).rows;
	const res = emptyResult();
	const seen = new Set<string>();
	const perCluster = new Map<string, number>();
	for (const m of rows) {
		if (seen.has(m.key)) continue; // closest cluster first (ORDER BY depth)
		const spec = byId.get(m.cluster)!;
		const p = parseForChain(m.address, m.chain);
		if (!p) continue;
		seen.add(m.key);
		perCluster.set(m.cluster, (perCluster.get(m.cluster) ?? 0) + 1);
		const depth = Number(m.depth);
		const date = m.ts ? new Date(m.ts).toISOString().slice(0, 10) : 'unknown date';
		const value = m.value === null ? '' : `${Number(m.value)} ${UNIT[m.chain] ?? m.chain} `;
		const entry: ListEntry = {
			source: 'cluster',
			key: p.key,
			chain: m.chain,
			address: p.address,
			category: 'hack',
			risk: clusterRisk(spec, depth),
			code: 'HACK_CLUSTER',
			entity: spec.entity,
			text: `${spec.name}: received ${value}from ${m.from_address ?? 'an attributed address'} (${depth} hop${depth > 1 ? 's' : ''} from the attributed addresses) on ${date}`,
			...(m.tx ? { refUrl: l1TxUrl(m.chain, m.tx), refId: m.tx } : {}),
			...(m.ts ? { listedAt: new Date(m.ts).toISOString() } : {}),
			meta: {
				cluster: spec.id,
				incident: spec.incident,
				depth,
				from: m.from_address,
				value: m.value,
				sourceRef: spec.ref,
				since: spec.window.from,
				...(spec.urgent ? { urgent: true } : {})
			}
		};
		res.entries.push(entry);
	}
	res.version = [...perCluster.entries()].map(([id, n]) => `${id}:${n}`).join(',');
	return res;
}

/**
 * The union rebuild (read every cluster's members, apply the `cluster`
 * source) is serialized within the process: the scheduled run and the
 * incident path can expand at the same time, but one must never apply a
 * union it read before the other saved its members (that would delist them
 * until the next run).
 */
let unionChain: Promise<unknown> = Promise.resolve();
function serializedUnion<T>(fn: () => Promise<T>): Promise<T> {
	const run = unionChain.then(fn, fn);
	unionChain = run.catch(() => undefined);
	return run;
}

export async function runClusterExpansion(sql: Sql, opts: ClusterRunOptions = {}): Promise<ClusterRunResult> {
	const t0 = Date.now();
	const log: Logger = opts.logger ?? silentLogger;
	const now = opts.now ?? new Date();
	const deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : undefined;
	const runs: ClusterRunSummary[] = [];
	try {
		const specs = opts.specs ?? [...curatedClusterSpecs(), ...(await manualClusterSpecs(sql, now))];
		const last = await loadRuns(sql);
		const withMembers = new Set(
			(await sql.query<{ cluster: string }>(`SELECT DISTINCT cluster FROM oz_cluster_members`)).rows.map((r) => r.cluster)
		);
		const exclude = await thorchainInbound({ http: opts.http });
		const budget = { left: opts.maxRequests ?? 15_000 };
		const selected = specs.filter((s) => !opts.only || opts.only(s));
		const lanes = new Map<string, ClusterSpec[]>();
		for (const s of [...selected].sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1) || b.window.from.localeCompare(a.window.from))) {
			lanes.set(s.chain, [...(lanes.get(s.chain) ?? []), s]);
		}
		const runOne = async (spec: ClusterSpec) => {
			const seeds = await specSeeds(sql, spec);
			const base = { cluster: spec.id, incident: spec.incident, chain: spec.chain, members: 0, newMembers: 0, requests: 0 };
			if (!seeds.length) {
				runs.push({ ...base, plan: 'skip', status: 'skipped', why: 'no seeds (sync its seed sources first)' });
				return;
			}
			let plan = planRun(spec, seeds, last.get(spec.id), withMembers.has(spec.id), now.getTime(), opts.periodMs ?? CLUSTER_PERIOD_MS);
			if (opts.force && plan.mode === 'skip') plan = { mode: 'full' };
			if (plan.mode === 'skip') {
				runs.push({ ...base, plan: 'skip', status: 'skipped', why: plan.why });
				return;
			}
			const previous = last.get(spec.id);
			if (plan.mode === 'adopt') {
				const n = (await memberAddresses(sql, spec.id)).length;
				await saveRun(sql, spec, seeds, true, { stop: 'adopted' }, n, []);
				runs.push({ ...base, plan: 'adopt', status: 'adopted', members: n, why: 'members found before pass E taken over as a complete run' });
				log.info(`cluster ${spec.id}: ${n} members from the previous expansion adopted`);
				return;
			}
			if (!isEvmChain(spec.chain) && !isUtxoChain(spec.chain)) {
				runs.push({ ...base, plan: plan.mode, status: 'skipped', why: `no explorer for ${spec.chain}` });
				return;
			}
			if (budget.left <= 0) {
				runs.push({ ...base, plan: plan.mode, status: 'skipped', why: 'run budget spent (due again next run)' });
				log.warn(`cluster ${spec.id}: not run, this run's request budget is spent`);
				return;
			}
			const known = plan.mode === 'full' ? [] : await memberAddresses(sql, spec.id);
			const resume = plan.mode === 'resume' || plan.mode === 'incremental' ? { frontier: plan.frontier, known } : undefined;
			const maxRequests = Math.min(spec.maxRequests, budget.left);
			// services an earlier run of this cluster found are never followed or listed again
			const knownServices = previous?.service_list ?? [];
			const common = { http: opts.http, env: opts.env, logger: log, maxRequests, deadline, resume, exclude: new Set([...exclude, ...knownServices]), now: now.getTime() };
			const r = isEvmChain(spec.chain) ? await expandEvm(spec, seeds, common) : await expandUtxo(spec, seeds, common);
			budget.left -= r.requests;
			const members = [...r.members.values()];
			const replace = plan.mode === 'full' && !r.truncated;
			const services = [...new Set([...knownServices, ...r.services])];
			await saveMembers(sql, spec, members, replace, services);
			const total = (await memberAddresses(sql, spec.id)).length;
			await saveRun(sql, spec, seeds, !r.truncated, r, total, services);
			const summary: ClusterRunSummary = {
				...base,
				plan: plan.mode,
				status: r.truncated ? 'partial' : 'complete',
				members: total,
				newMembers: members.length,
				requests: r.requests,
				...(r.stop ? { stop: r.stop, frontierLeft: r.frontier.length } : {})
			};
			runs.push(summary);
			const skippedNote = Object.entries(r.skipped)
				.filter(([, n]) => n > 0)
				.map(([k, n]) => `${k} ${n}`)
				.join(', ');
			const msg = `cluster ${spec.id} (${plan.mode}): ${total} members (+${members.length}), ${r.requests} requests${r.stop ? `, cut short (${r.stop}) with ${r.frontier.length} nodes left for the next run` : ''}${skippedNote ? `; skipped: ${skippedNote}` : ''}${r.error ? `; ${r.error}` : ''}`;
			if (r.stop) log.warn(msg);
			else log.info(msg);
		};
		await Promise.all(
			[...lanes.values()].map(async (lane) => {
				for (const spec of lane) {
					try {
						await runOne(spec);
					} catch (e) {
						runs.push({ cluster: spec.id, incident: spec.incident, chain: spec.chain, plan: 'full', status: 'skipped', members: 0, newMembers: 0, requests: 0, why: (e as Error).message });
						log.warn(`cluster ${spec.id} failed: ${(e as Error).message}`);
					}
				}
			})
		);
		const stats = await serializedUnion(async () => {
			const merged = await clusterSourceResult(sql, specs);
			for (const r of runs) {
				if (r.status === 'complete' || r.status === 'adopted' || r.why === 'complete (window closed)' || r.why === 'window open; ran recently') continue;
				merged.notes.push(`${r.cluster}: ${r.status}${r.stop ? ` (${r.stop}, ${r.frontierLeft} left)` : ''}${r.why ? ` — ${r.why}` : ''}`);
			}
			return applySourceResult(sql, CLUSTER_SOURCE, merged);
		});
		await sql.query(
			`INSERT INTO sync_log (type, status, records_processed, flags_found, duration, error) VALUES ('OZ:cluster', 'success', $1, $2, $3, NULL)`,
			[stats.active, runs.filter((r) => r.status === 'partial').length, Date.now() - t0]
		);
		return { source: 'cluster', ok: true, stats, durationMs: Date.now() - t0, runs };
	} catch (e) {
		const error = (e as Error).message;
		await recordSourceError(sql, CLUSTER_SOURCE, error).catch(() => undefined);
		return { source: 'cluster', ok: false, error, durationMs: Date.now() - t0, runs };
	}
}
