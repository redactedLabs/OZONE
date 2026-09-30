/**
 * Tracing jobs: history backfill (per flagged address, highest risk first)
 * and the real-time follower (new THORChain actions since a cursor).
 */
import { riskRank } from '../../../ozone-client/src/index.js';
import {
	markChainChecked,
	markChecked,
	getState,
	loadTraceIndex,
	pendingChainChecks,
	pendingChecks,
	queryForms,
	recordDustFlows,
	recordHits,
	recordPayerLinks,
	setState,
	type DustRecordResult
} from '../store/trace.js';
import type { Logger, Sql } from '../types.js';
import { silentLogger } from '../types.js';
import { toChecksumAddress } from '../util/evm.js';
import { extractChainFlows, type ChainLike, type ChainRead } from './chain.js';
import type { ForwardRead, MidgardLike as Midgard } from './midgard.js';
import { loadPoolPrices, type PriceOracle } from './prices.js';
import { DEFAULT_TRACE_CONFIG, traceAction, traceFlows, traceRisk, type DustFlow, type IndexEntry, type PayerLink, type TraceConfig, type TraceHit } from './tracer.js';
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
	/** THORChain accounts found paying a listed address (recorded as links of the user screening). */
	links: number;
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
	links: PayerLink[];
	actions: number;
	maxHeight: number;
	service: boolean;
	pending: PendingAction[];
	/** The history continues past this check's page budget: check again from `maxHeight`. */
	more: boolean;
}> {
	const hits: TraceHit[] = [];
	const dust: DustFlow[] = [];
	const links: PayerLink[] = [];
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
			hits.push(...traceAction(a, lookup, prices, cfg, (d) => dust.push(d), (l) => links.push(l)));
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
	return { hits: dedupe(hits), dust, links, actions, maxHeight, service, pending, more };
}

export async function runTraceBackfill(sql: Sql, midgard: Midgard, opts: BackfillOptions = {}): Promise<BackfillResult> {
	const cfg = opts.cfg ?? DEFAULT_TRACE_CONFIG;
	const log = opts.logger ?? silentLogger;
	const prices = opts.prices ?? (await loadPoolPrices(midgard).catch(() => undefined));
	const deadline = Date.now() + (opts.timeBudgetMs ?? Infinity);
	const maxAddresses = opts.maxAddresses ?? Infinity;
	const res: BackfillResult = { checked: 0, actions: 0, hits: 0, traced: 0, dustTraced: 0, dustSkipped: 0, services: 0, errors: 0, remaining: 0, links: 0 };
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
					if (r.links.length) res.links += await recordPayerLinks(sql, r.links);
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
	/** THORChain accounts found paying a listed address (recorded as links of the user screening). */
	links?: number;
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
		/** Wall-clock budget of the re-read of pending actions (default PENDING_BUDGET_MS). */
		pendingBudgetMs?: number;
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
	const links: PayerLink[] = [];
	const onLink = (l: PayerLink) => links.push(l);
	const hits = dedupe(actions.flatMap((a) => traceAction(a, lookup, opts.prices, cfg, onDust, onLink)));

	// Streaming swaps (and delayed outbounds) are reported as `pending` with no
	// outputs yet: remember those that start at a flagged address and re-read
	// them until they settle. The new ones are stored before anything else can
	// go wrong; the re-read itself runs after the cursor has moved (see below).
	const pending = (await getState<PendingAction[]>(sql, 'trace:pending')) ?? [];
	const now = Date.now();
	let remembered = false;
	for (const a of actions) {
		if (a.status !== 'pending') continue;
		if (!a.in.some((t) => isFlaggedSender(t, lookup))) continue;
		const txid = actionTxid(a);
		if (!txid.startsWith('H') && !pending.some((p) => p.txid === txid)) {
			pending.push({ txid, height: Number(a.height), since: now });
			remembered = true;
		}
	}
	if (remembered) await setState(sql, 'trace:pending', pending);

	const rec = await recordHits(sql, hits);
	const linked = await recordPayerLinks(sql, links);
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
	// The cursor moves before the pending actions are re-read: that re-read is
	// up to 25 sequential Midgard requests, each of which can time out and
	// retry for minutes, and a cursor saved only after it would stay where it is
	// for as long as they fail. (On 2026-09-30 /api/health showed the cursor
	// unchanged for 16 h; the cause was not established — this closes one way
	// for that to happen.) What the re-read finds is recorded on its own.
	await setState(sql, 'trace:realtime', { height: to, ...(complete ? {} : { behind: true }) });

	const again: TraceHit[] = [];
	const againDust: DustFlow[] = [];
	const againLinks: PayerLink[] = [];
	const deadline = Date.now() + (opts.pendingBudgetMs ?? PENDING_BUDGET_MS);
	const still: PendingAction[] = [];
	for (const p of pending.slice(0, 25)) {
		if (now - p.since > 48 * 3600_000) continue; // give up after two days (the daily re-read covers it)
		const left = deadline - Date.now();
		const res = left > 0 ? await withTimeout(midgard.actions({ txid: p.txid, limit: 10 }), left).catch(() => undefined) : undefined;
		const settled = res?.actions.filter((a) => a.status !== 'pending') ?? [];
		if (!res || settled.length === 0) {
			still.push(p);
			continue;
		}
		for (const a of settled) again.push(...traceAction(a, lookup, opts.prices, cfg, (d) => againDust.push(d), (l) => againLinks.push(l)));
	}
	still.push(...pending.slice(25));
	let edges = rec.edges;
	let tracedNow = rec.traced;
	if (again.length) {
		const r2 = await recordHits(sql, dedupe(again));
		edges += r2.edges;
		tracedNow += r2.traced;
	}
	const linkedAgain = againLinks.length ? await recordPayerLinks(sql, againLinks) : 0;
	const smallAgain = againDust.length ? await recordDustFlows(sql, againDust, cfg, log) : { traced: 0 };
	await setState(sql, 'trace:pending', still);
	return {
		processed: actions.length,
		hits: edges,
		traced: tracedNow,
		dustTraced: small.traced + smallAgain.traced,
		links: linked + linkedAgain,
		from,
		to,
		complete,
		...(watch ? { watch } : {})
	};
}

/** Wall-clock budget of the pending re-read in one real-time tick. */
export const PENDING_BUDGET_MS = 60_000;

/** `p`, or a rejection once `ms` have passed (the request itself is not cancelled). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('timed out')), ms);
		timer.unref?.();
	});
	return Promise.race([p, limit]).finally(() => clearTimeout(timer));
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

// ---------------------------------------------------------------------------
// Chain transaction events: value flows through CosmWasm contracts (trace/chain.ts)
// ---------------------------------------------------------------------------

export interface ChainTickResult {
	/** Contract transactions read. */
	processed: number;
	hits: number;
	traced: number;
	dustTraced: number;
	/** THORChain accounts found paying a listed address. */
	links: number;
	from: number;
	to: number;
	/** The cursor reached the newest block (false: still catching up, continued by the next tick). */
	complete: boolean;
	/** Why nothing was read. */
	skipped?: string;
}

/** Blocks one tick reads (about 20 minutes of chain time; a follower that fell behind catches up over several ticks). */
export const CHAIN_TICK_BLOCKS = 200;
/** Pages of contract transactions one tick reads at most. */
export const CHAIN_TICK_PAGES = 40;

/**
 * The real-time follower of the chain: the contract transactions of the
 * blocks after the stored cursor (`oz_state` `trace:chain`), in chain order.
 * The first run starts at the current head (the history of each flagged
 * account is runChainBackfill's job). Flows out of flagged accounts flag their
 * recipients like a Midgard action's do. A tick without prices reads nothing:
 * a flow is only read with a price, so a cursor that moved without one would
 * drop them for good.
 */
export async function runChainTick(
	sql: Sql,
	chain: ChainLike,
	opts: {
		cfg?: TraceConfig;
		prices?: PriceOracle;
		index?: Map<string, IndexEntry>;
		logger?: Logger;
		maxBlocks?: number;
		maxPages?: number;
	} = {}
): Promise<ChainTickResult> {
	const cfg = opts.cfg ?? DEFAULT_TRACE_CONFIG;
	const log = opts.logger ?? silentLogger;
	const none = (from: number, to: number, extra: Partial<ChainTickResult> = {}): ChainTickResult => ({
		processed: 0,
		hits: 0,
		traced: 0,
		dustTraced: 0,
		links: 0,
		from,
		to,
		complete: true,
		...extra
	});
	const head = await chain.latestHeight();
	const state = await getState<{ height: number }>(sql, 'trace:chain');
	const from = state?.height ?? 0;
	if (!from) {
		await setState(sql, 'trace:chain', { height: head });
		return none(head, head);
	}
	if (head <= from) return none(from, from);
	if (!opts.prices) return none(from, from, { skipped: 'no prices yet' });
	const to = Math.min(head, from + (opts.maxBlocks ?? CHAIN_TICK_BLOCKS));
	const progress: ChainRead = { complete: true };
	const txs = [];
	for await (const tx of chain.wasmTxs({ fromHeight: from + 1, toHeight: to, maxPages: opts.maxPages ?? CHAIN_TICK_PAGES, progress })) txs.push(tx);

	const index = opts.index ?? (await loadTraceIndex(sql));
	const lookup = (k: string) => index.get(k);
	const dust: DustFlow[] = [];
	const links: PayerLink[] = [];
	const hits = dedupe(txs.flatMap((tx) => traceFlows(extractChainFlows(tx, opts.prices), lookup, cfg, (d) => dust.push(d), (l) => links.push(l))));
	const rec = await recordHits(sql, hits);
	const linked = await recordPayerLinks(sql, links);
	const small = await recordDustFlows(sql, dust, cfg, log);
	if (small.traced) log.info(`trace: ${small.traced} recipient(s) traced by a total of small transfers (contract flows)`);

	let upTo = to;
	if (!progress.complete) {
		// the newest height read may continue on the next page: the next tick reads it again
		upTo = Math.max(from, (progress.resumeHeight ?? from + 1) - 1);
		if (upTo <= from) {
			upTo = progress.resumeHeight ?? to;
			log.warn(`trace: chain follower moved past height ${upTo} after reading ${txs.length} contract transactions of it in one tick`);
		}
		log.info(`trace: chain follower catching up: ${txs.length} contract transactions up to height ${upTo}`);
	}
	await setState(sql, 'trace:chain', { height: upTo, ...(upTo < head ? { behind: true } : {}) });
	return { processed: txs.length, hits: rec.edges, traced: rec.traced, dustTraced: small.traced, links: linked, from, to: upTo, complete: upTo >= head };
}

/**
 * Pages of contract transactions read per check of one account. A search page
 * of one account's history takes seconds on the public gateway (measured:
 * ~14 s for an account with 4,000 of them), so a check reads 1,000
 * transactions (2,000 for a flagged account that is never a service) and a
 * longer history continues in the next slice; any other account with more
 * than one check's worth is a bot or a service and is not followed.
 */
export const CHAIN_CHECK_PAGES = 20;
export const CHAIN_CHECK_PAGES_NEVER_SERVICE = 40;

/** The history of one flagged thor1 account: its contract transactions from `fromHeight`, oldest first. */
export async function checkChainHistory(
	chain: ChainLike,
	key: string,
	fromHeight: number,
	lookup: (key: string) => IndexEntry | undefined,
	prices: PriceOracle,
	cfg: TraceConfig,
	pages: PageBudget = {},
	deadline?: number
): Promise<{ hits: TraceHit[]; dust: DustFlow[]; links: PayerLink[]; txs: number; maxHeight: number; service: boolean; more: boolean }> {
	const hits: TraceHit[] = [];
	const dust: DustFlow[] = [];
	const links: PayerLink[] = [];
	const entry = lookup(key);
	// the same rule as checkAddress: a listed account (or a high-risk traced one) is never a service
	const neverService =
		!!entry && (entry.hop === 0 || riskRank(traceRisk(entry.originRisk, entry.hop, undefined, 'value', cfg) ?? 'none') >= riskRank('high'));
	const progress: ChainRead = { complete: true };
	const seen = new Set<string>();
	let txs = 0;
	let maxHeight = fromHeight;
	for await (const tx of chain.wasmTxs({
		signer: key.slice('thor:'.length),
		fromHeight,
		maxPages: neverService ? (pages.neverService ?? CHAIN_CHECK_PAGES_NEVER_SERVICE) : (pages.normal ?? CHAIN_CHECK_PAGES),
		deadline,
		progress
	})) {
		if (seen.has(tx.hash)) continue;
		seen.add(tx.hash);
		txs++;
		maxHeight = Math.max(maxHeight, tx.height);
		hits.push(...traceFlows(extractChainFlows(tx, prices), lookup, cfg, (d) => dust.push(d), (l) => links.push(l)));
	}
	// more than one check's budget of contract transactions: a bot or a service (unless a listed or high-risk account)
	const service = !neverService && !progress.complete && (deadline === undefined || Date.now() <= deadline);
	let more = !progress.complete && !service;
	if (more) maxHeight = Math.max(fromHeight, progress.resumeHeight ?? maxHeight);
	// a read that cannot move forward (one height with more transactions than the whole budget) must not spin
	if (more && maxHeight <= fromHeight) more = false;
	return { hits: dedupe(hits), dust, links, txs, maxHeight, service, more };
}

export interface ChainBackfillResult {
	checked: number;
	txs: number;
	hits: number;
	traced: number;
	dustTraced: number;
	links: number;
	services: number;
	errors: number;
	remaining: number;
}

/**
 * Reads the contract transactions of every flagged thor1 account that has not
 * been read yet (listed ones, and traced ones since they were tainted), risk
 * first — the chain counterpart of runTraceBackfill with its own progress
 * table, so the Midgard history is never read again for it. New flagged
 * accounts found on the way are read in the next round.
 */
export async function runChainBackfill(
	sql: Sql,
	chain: ChainLike,
	opts: {
		cfg?: TraceConfig;
		prices?: PriceOracle;
		logger?: Logger;
		maxAddresses?: number;
		timeBudgetMs?: number;
		filter?: (key: string, e: IndexEntry) => boolean;
		pages?: PageBudget;
	} = {}
): Promise<ChainBackfillResult> {
	const cfg = opts.cfg ?? DEFAULT_TRACE_CONFIG;
	const log = opts.logger ?? silentLogger;
	const deadline = Date.now() + (opts.timeBudgetMs ?? Infinity);
	const maxAddresses = opts.maxAddresses ?? Infinity;
	const res: ChainBackfillResult = { checked: 0, txs: 0, hits: 0, traced: 0, dustTraced: 0, links: 0, services: 0, errors: 0, remaining: 0 };
	if (!opts.prices) return res; // a flow is only read with a price: see runChainTick
	const prices = opts.prices;
	const attempted = new Set<string>();
	for (;;) {
		const index = await loadTraceIndex(sql);
		const tasks = await pendingChainChecks(sql, index, cfg.maxHops, 5000, (key, e) => !attempted.has(key) && (!opts.filter || opts.filter(key, e)));
		res.remaining = tasks.length;
		if (!tasks.length || Date.now() > deadline || res.checked >= maxAddresses) break;
		const lookup = (k: string) => index.get(k);
		for (const task of tasks.slice(0, Math.min(tasks.length, maxAddresses - res.checked, 200))) {
			if (Date.now() > deadline) break;
			attempted.add(task.key);
			try {
				const r = await checkChainHistory(chain, task.key, task.fromHeight, lookup, prices, cfg, opts.pages, deadline);
				if (r.hits.length) {
					const rec = await recordHits(sql, r.hits);
					res.hits += rec.edges;
					res.traced += rec.traced;
					log.info(`chain ${task.key}: ${r.txs} contract transactions, ${r.hits.length} flows flagged`);
				}
				if (r.dust.length) res.dustTraced += (await recordDustFlows(sql, r.dust, cfg, log)).traced;
				if (r.links.length) res.links += await recordPayerLinks(sql, r.links);
				res.txs += r.txs;
				res.checked++;
				if (r.service) res.services++;
				if (r.more) log.info(`chain ${task.key}: long history, continuing from height ${r.maxHeight} in the next slice`);
				await markChainChecked(sql, task.key, r.service ? 'service' : r.more ? 'pending' : 'done', { height: r.maxHeight, txs: r.txs });
			} catch (e) {
				res.errors++;
				await markChainChecked(sql, task.key, 'error', { error: (e as Error).message });
				log.warn(`chain ${task.key} failed: ${(e as Error).message}`);
			}
		}
		if (Date.now() > deadline) break;
	}
	return res;
}
