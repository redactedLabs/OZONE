/**
 * Tracing jobs: history backfill (per flagged address, highest risk first)
 * and the real-time follower (new THORChain actions since a cursor).
 */
import { riskRank } from '../../../ozone-client/src/index.js';
import { markChecked, getState, loadTraceIndex, pendingChecks, queryForms, recordDustFlows, recordHits, setState, type DustRecordResult } from '../store/trace.js';
import type { Logger, Sql } from '../types.js';
import { silentLogger } from '../types.js';
import { toChecksumAddress } from '../util/evm.js';
import type { ForwardRead, MidgardLike as Midgard } from './midgard.js';
import { loadPoolPrices, type PriceOracle } from './prices.js';
import { DEFAULT_TRACE_CONFIG, traceAction, traceRisk, type DustFlow, type IndexEntry, type TraceConfig, type TraceHit } from './tracer.js';
import { actionTxid, parseTxAddress } from './flows.js';
import { enqueueWatch, watchCandidates, type WatchConfig } from './watcher.js';

/** An address with more THORChain actions than this is treated as a service and not propagated. */
export const SERVICE_ACTIONS = 2000;

/** A THORChain action seen `pending` (no outputs yet): re-read until it settles. */
export interface PendingAction {
	txid: string;
	height: number;
	since: number;
}

export interface BackfillOptions {
	cfg?: TraceConfig;
	prices?: PriceOracle;
	logger?: Logger;
	/** Stop after this many addresses (per call). */
	maxAddresses?: number;
	/** Stop after this long (ms). */
	timeBudgetMs?: number;
	/** Only check keys matching this predicate (e.g. a single incident). */
	filter?: (key: string, e: IndexEntry) => boolean;
	/** Parallel address checks (each is rate-limited by the Midgard client). */
	concurrency?: number;
	/** Midgard pages per check (default CHECK_PAGES / CHECK_PAGES_NEVER_SERVICE). */
	pages?: PageBudget;
}

export interface PageBudget {
	normal?: number;
	neverService?: number;
}

export interface BackfillResult {
	checked: number;
	actions: number;
	hits: number;
	traced: number;
	/** Recipients newly traced by a total of small (sub-dust) transfers. */
	dustTraced: number;
	/** Such recipients published but not followed onward (fan-out cap). */
	dustSkipped: number;
	services: number;
	errors: number;
	remaining: number;
}

function dedupe(hits: TraceHit[]): TraceHit[] {
	const seen = new Set<string>();
	return hits.filter((h) => {
		const id = `${h.txid}|${h.fromKey}|${h.toKey}`;
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

/**
 * Pages read per check. A listed key (or a high-risk traced one) is never a
 * service, so its history is read to the end — across several checks when it
 * is longer than one check's budget; any other key with more than
 * SERVICE_ACTIONS actions is a service and not followed.
 */
export const CHECK_PAGES = SERVICE_ACTIONS / 50 + 1;
export const CHECK_PAGES_NEVER_SERVICE = 200;

export async function checkAddress(
	midgard: Midgard,
	key: string,
	fromHeight: number,
	lookup: (key: string) => IndexEntry | undefined,
	prices: PriceOracle | undefined,
	cfg: TraceConfig,
	pages: PageBudget = {}
): Promise<{
	hits: TraceHit[];
	dust: DustFlow[];
	actions: number;
	maxHeight: number;
	service: boolean;
	pending: PendingAction[];
	/** The history continues past this check's page budget: check again from `maxHeight`. */
	more: boolean;
}> {
	const hits: TraceHit[] = [];
	const dust: DustFlow[] = [];
	const pending: PendingAction[] = [];
	let actions = 0;
	let maxHeight = fromHeight;
	// A pending action (a streaming swap or delayed outbound still in flight,
	// with no outputs yet) must never be folded into the cursor: once
	// checked_height reaches or passes it, a height-cursor scan can never
	// re-read it, however many times the address is later rechecked.
	let lowestPendingHeight: number | undefined;
	let service = false;
	// A hop-0 listed address, or one whose own trace risk already decays to
	// high or above, is always traced: a raw action count is trivially
	// inflatable (by the address itself, or by a third party sending it many
	// small actions) and must not permanently exempt it.
	const entry = lookup(key);
	const neverService =
		!!entry && (entry.hop === 0 || riskRank(traceRisk(entry.originRisk, entry.hop, undefined, 'value', cfg) ?? 'none') >= riskRank('high'));
	const seenActions = new Set<string>();
	let more = false;
	for (const form of queryForms(key, toChecksumAddress)) {
		let n = 0;
		// Oldest first from `fromHeight` (inclusive), so a read cut short by the
		// page budget resumes where it stopped instead of skipping history.
		const progress: ForwardRead = { complete: true };
		for await (const a of midgard.actionsForAddress(form, {
			fromHeight,
			maxPages: neverService ? (pages.neverService ?? CHECK_PAGES_NEVER_SERVICE) : (pages.normal ?? CHECK_PAGES),
			progress
		})) {
			n++;
			const id = `${a.height}|${a.type}|${a.in[0]?.txID ?? ''}|${a.out[0]?.address ?? ''}`;
			if (seenActions.has(id)) continue;
			seenActions.add(id);
			actions++;
			const h = Number(a.height);
			if (a.status === 'pending') {
				lowestPendingHeight = lowestPendingHeight === undefined ? h : Math.min(lowestPendingHeight, h);
				const txid = actionTxid(a);
				if (!txid.startsWith('H')) pending.push({ txid, height: h, since: Date.now() });
			} else {
				maxHeight = Math.max(maxHeight, h);
			}
			hits.push(...traceAction(a, lookup, prices, cfg, (d) => dust.push(d)));
		}
		if (!neverService && n >= SERVICE_ACTIONS) service = true;
		else if (!progress.complete) more = true;
	}
	if (lowestPendingHeight !== undefined) maxHeight = Math.min(maxHeight, lowestPendingHeight - 1);
	// `maxHeight` is where the next check starts (Midgard's fromHeight is
	// inclusive, so a height the budget cut in half is read again in full).
	// A read that cannot move forward (one height with more actions than the
	// whole budget) must not spin: it is then reported as finished.
	if (more && maxHeight <= fromHeight) more = false;
	return { hits: dedupe(hits), dust, actions, maxHeight, service, pending, more };
}

export async function runTraceBackfill(sql: Sql, midgard: Midgard, opts: BackfillOptions = {}): Promise<BackfillResult> {
	const cfg = opts.cfg ?? DEFAULT_TRACE_CONFIG;
	const log = opts.logger ?? silentLogger;
	const prices = opts.prices ?? (await loadPoolPrices(midgard).catch(() => undefined));
	const deadline = Date.now() + (opts.timeBudgetMs ?? Infinity);
	const maxAddresses = opts.maxAddresses ?? Infinity;
	const res: BackfillResult = { checked: 0, actions: 0, hits: 0, traced: 0, dustTraced: 0, dustSkipped: 0, services: 0, errors: 0, remaining: 0 };
	const attempted = new Set<string>();
	// Serializes trace:pending read-modify-writes across the concurrent
	// per-address workers below (a plain get/set would drop a concurrent
	// worker's addition otherwise).
	let pendingChain: Promise<void> = Promise.resolve();
	const recordPending = (items: PendingAction[]): Promise<void> => {
		if (!items.length) return pendingChain;
		pendingChain = pendingChain.then(async () => {
			const existing = (await getState<PendingAction[]>(sql, 'trace:pending')) ?? [];
			let changed = false;
			for (const p of items) {
				if (!existing.some((e) => e.txid === p.txid)) {
					existing.push(p);
					changed = true;
				}
			}
			if (changed) await setState(sql, 'trace:pending', existing);
		});
		return pendingChain;
	};
	// Small transfers are recorded one address at a time, so the fan-out cap
	// counts every promotion the concurrent workers below make.
	let dustChain: Promise<unknown> = Promise.resolve();
	const recordDust = (dust: DustFlow[]): Promise<DustRecordResult> => {
		const run = dustChain.then(() => recordDustFlows(sql, dust, cfg, log));
		dustChain = run.catch(() => undefined);
		return run;
	};
	for (;;) {
		const index = await loadTraceIndex(sql);
		const tasks = await pendingChecks(
			sql,
			index,
			cfg.maxHops,
			5000,
			(key, e) => !attempted.has(key) && (!opts.filter || opts.filter(key, e))
		);
		res.remaining = tasks.length;
		if (!tasks.length || Date.now() > deadline || res.checked >= maxAddresses) break;
		const round = tasks.slice(0, Math.min(tasks.length, maxAddresses - res.checked, 500));
		for (const t of round) attempted.add(t.key);
		const lookup = (k: string) => index.get(k);
		let cursor = 0;
		const worker = async () => {
			while (cursor < round.length && Date.now() <= deadline) {
				const task = round[cursor++];
				try {
					const r = await checkAddress(midgard, task.key, task.fromHeight, lookup, prices, cfg, opts.pages);
					if (r.hits.length) {
						const rec = await recordHits(sql, r.hits);
						res.hits += rec.edges;
						res.traced += rec.traced;
						log.info(`trace ${task.key}: ${r.actions} actions, ${r.hits.length} flows flagged`);
					}
					if (r.dust.length) {
						const d = await recordDust(r.dust);
						res.dustTraced += d.traced;
						res.dustSkipped += d.skipped;
						if (d.traced) log.info(`trace ${task.key}: ${d.traced} recipient(s) traced by a total of small transfers`);
					}
					if (r.pending.length) await recordPending(r.pending);
					res.actions += r.actions;
					res.checked++;
					if (r.service) res.services++;
					// A history longer than one check's budget stays pending: the next
					// slice continues from where this one stopped.
					if (r.more) log.info(`trace ${task.key}: long history, continuing from height ${r.maxHeight} in the next slice`);
					await markChecked(sql, task.key, r.service ? 'service' : r.more ? 'pending' : 'done', { height: r.maxHeight, actions: r.actions });
				} catch (e) {
					res.errors++;
					await markChecked(sql, task.key, 'error', { error: (e as Error).message });
					log.warn(`trace ${task.key} failed: ${(e as Error).message}`);
				}
			}
		};
		await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker));
		if (Date.now() > deadline) break;
	}
	return res;
}

function isFlaggedSender(t: { address: string; coins: Array<{ asset: string }> }, lookup: (k: string) => IndexEntry | undefined): boolean {
	const p = parseTxAddress(t as never);
	return !!p && !!lookup(p.key);
}

export interface RealtimeResult {
	processed: number;
	hits: number;
	traced: number;
	/** Recipients newly traced by a total of small (sub-dust) transfers. */
	dustTraced: number;
	from: number;
	to: number;
	/** The cursor reached the newest action (false: still catching up, continued by the next tick). */
	complete: boolean;
	/** Inbound watcher: large L1 inbounds found in this tick and queued for a look-back at their funders. */
	watch?: { candidates: number; queued: number; error?: string };
}

/**
 * Processes THORChain actions newer than the stored cursor, in chain order.
 * A follower that fell behind (a restart, an outage) reads forward from its
 * cursor, at most `maxPages` pages per tick, and moves the cursor only over
 * what it has read: it catches up over the next ticks and never skips a
 * range, so no flagged address has to re-read its history for the gap.
 */
export async function runRealtimeTick(
	sql: Sql,
	midgard: Midgard,
	opts: {
		cfg?: TraceConfig;
		prices?: PriceOracle;
		maxPages?: number;
		index?: Map<string, IndexEntry>;
		logger?: Logger;
		/** Queue large inbounds from unflagged L1 addresses for a funder look-back (trace/watcher.ts). */
		watch?: WatchConfig;
	} = {}
): Promise<RealtimeResult> {
	const cfg = opts.cfg ?? DEFAULT_TRACE_CONFIG;
	const log = opts.logger ?? silentLogger;
	const state = await getState<{ height: number }>(sql, 'trace:realtime');
	let from = state?.height ?? 0;
	if (!from) {
		// first run: start at the current head (history is the backfill's job)
		const head = await midgard.actions({ limit: 1 });
		from = Number(head.actions[0]?.height ?? 0);
		await setState(sql, 'trace:realtime', { height: from });
		return { processed: 0, hits: 0, traced: 0, dustTraced: 0, from, to: from, complete: true };
	}
	const { actions, complete, head, resumeAfter } = await midgard.actionsSince(from, opts.maxPages ?? 40);
	const index = opts.index ?? (await loadTraceIndex(sql));
	const lookup = (k: string) => index.get(k);
	const dust: DustFlow[] = [];
	const onDust = (d: DustFlow) => dust.push(d);
	const hits = dedupe(actions.flatMap((a) => traceAction(a, lookup, opts.prices, cfg, onDust)));

	// Streaming swaps (and delayed outbounds) are reported as `pending` with no
	// outputs yet: remember those that start at a flagged address and re-read
	// them until they settle.
	const pending = (await getState<PendingAction[]>(sql, 'trace:pending')) ?? [];
	const now = Date.now();
	for (const a of actions) {
		if (a.status !== 'pending') continue;
		if (!a.in.some((t) => isFlaggedSender(t, lookup))) continue;
		const txid = actionTxid(a);
		if (!txid.startsWith('H') && !pending.some((p) => p.txid === txid)) pending.push({ txid, height: Number(a.height), since: now });
	}
	const still: PendingAction[] = [];
	for (const p of pending.slice(0, 25)) {
		if (now - p.since > 48 * 3600_000) continue; // give up after two days (the daily re-read covers it)
		const res = await midgard.actions({ txid: p.txid, limit: 10 }).catch(() => undefined);
		const settled = res?.actions.filter((a) => a.status !== 'pending') ?? [];
		if (!res || settled.length === 0) {
			still.push(p);
			continue;
		}
		for (const a of settled) hits.push(...traceAction(a, lookup, opts.prices, cfg, onDust));
	}
	still.push(...pending.slice(25));
	await setState(sql, 'trace:pending', still);

	const rec = await recordHits(sql, dedupe(hits));
	const small = await recordDustFlows(sql, dust, cfg, log);
	if (small.traced) log.info(`trace: ${small.traced} recipient(s) traced by a total of small transfers`);
	let to = complete ? head : (resumeAfter ?? from);
	if (!complete && to <= from) {
		// One height with more actions than a whole tick's budget cannot be
		// split by height: accept what was read rather than stall on it.
		to = head;
		log.warn(`trace: real-time follower moved past height ${head} after reading ${actions.length} actions of it in one tick`);
	}
	if (!complete) log.info(`trace: real-time follower catching up: ${actions.length} actions up to height ${to}`);
	// The watcher only enqueues here (a bounded insert): a look-back never runs
	// inside the follower, and an error here never stops the follower.
	let watch: RealtimeResult['watch'];
	if (opts.watch) {
		try {
			const candidates = watchCandidates(actions, lookup, opts.prices, opts.watch);
			const { queued } = candidates.length ? await enqueueWatch(sql, candidates, opts.watch) : { queued: 0 };
			watch = { candidates: candidates.length, queued };
		} catch (e) {
			watch = { candidates: 0, queued: 0, error: (e as Error).message };
			log.warn(`watch: enqueue failed (the follower continues): ${(e as Error).message}`);
		}
	}
	await setState(sql, 'trace:realtime', { height: to, ...(complete ? {} : { behind: true }) });
	return { processed: actions.length, hits: rec.edges, traced: rec.traced, dustTraced: small.traced, from, to, complete, ...(watch ? { watch } : {}) };
}

/** Marks every checked address for an incremental re-read (e.g. daily). */
export async function scheduleRecheck(sql: Sql, olderThanMs: number): Promise<number> {
	const r = await sql.query<{ n: number }>(
		`WITH u AS (UPDATE oz_trace_checked SET status = 'pending'
		   WHERE status IN ('done','error') AND checked_at < now() - ($1::text || ' milliseconds')::interval RETURNING 1)
		 SELECT count(*)::int AS n FROM u`,
		[String(olderThanMs)]
	);
	return r.rows[0]?.n ?? 0;
}
