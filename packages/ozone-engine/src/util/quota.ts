/**
 * A daily request budget for one upstream that every job shares, with
 * priorities. Midgard on Liquify's free gateway allows about 50,000 requests
 * a day per IP; the worker used more than that (account discovery alone
 * polled once a second), and once the gateway answered 429 the real-time
 * follower stalled with everything else (2026-10-04 from 15:05 UTC).
 *
 * The budget is a token bucket that refills at `dailyLimit / 24 h` and holds
 * one hour of requests. A priority may only take a token while the bucket
 * keeps its reserve for the priorities above it:
 *
 * - `realtime` (the real-time follower, the incident path, pool prices):
 *   any token, up to `hardLimit` requests a day;
 * - `links` (account discovery: linked L1 addresses, LP members): only while
 *   more than 35 % of an hour's tokens are left, and at most `dailyLimit`
 *   requests a day in total;
 * - `backfill` (history backfill, cluster-related reads, classification):
 *   only while more than half of an hour's tokens are left, same daily cap.
 *
 * After a 429 the lower priorities pause for `pauseAfter429Ms`; the follower
 * keeps its pace. The counters (requests today, per priority, last success,
 * last 429, failing since) are what /api/health publishes.
 */
export type QuotaPriority = 'realtime' | 'links' | 'backfill';

export const QUOTA_PRIORITIES: readonly QuotaPriority[] = ['realtime', 'links', 'backfill'];

/** Share of the bucket a priority must leave untouched. */
export const QUOTA_RESERVE: Record<QuotaPriority, number> = { realtime: 0, links: 0.35, backfill: 0.5 };

export interface QuotaUsage {
	/** UTC day the counters belong to (YYYY-MM-DD). */
	day: string;
	dailyLimit: number;
	requestsToday: number;
	byPriority: Record<QuotaPriority, number>;
	/** Requests a lower priority was refused today (it waited, or gave up and left the work for later). */
	deniedToday: number;
	/** Requests answered 429 today. */
	rateLimitedToday: number;
	lastSuccessAt?: string;
	lastFailureAt?: string;
	last429At?: string;
	lastError?: string;
	/** Since when every request has failed (unset again after a success). */
	failingSince?: string;
	/** Tokens in the bucket (of `capacity`). */
	tokens?: number;
	capacity?: number;
}

export interface QuotaOptions {
	dailyLimit: number;
	/** Requests a day the `realtime` priority may make at most (default 1.2 × dailyLimit). */
	hardLimit?: number;
	reserve?: Partial<Record<QuotaPriority, number>>;
	pauseAfter429Ms?: number;
	now?: () => number;
}

export class QuotaDenied extends Error {
	constructor(
		readonly priority: QuotaPriority,
		readonly why: string
	) {
		super(`request budget: ${priority} request refused (${why})`);
		this.name = 'QuotaDenied';
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const emptyByPriority = (): Record<QuotaPriority, number> => ({ realtime: 0, links: 0, backfill: 0 });

export class DailyQuota {
	readonly dailyLimit: number;
	readonly hardLimit: number;
	/** Tokens the bucket holds at most: one hour of requests. */
	readonly capacity: number;
	private readonly ratePerMs: number;
	private readonly reserve: Record<QuotaPriority, number>;
	private readonly pauseAfter429Ms: number;
	private readonly now: () => number;
	private tokens: number;
	private lastRefill: number;
	private pausedUntil = 0;
	private usage: QuotaUsage;

	constructor(opts: QuotaOptions) {
		this.dailyLimit = Math.max(1, Math.floor(opts.dailyLimit));
		this.hardLimit = Math.max(this.dailyLimit, Math.floor(opts.hardLimit ?? this.dailyLimit * 1.2));
		this.capacity = Math.max(1, this.dailyLimit / 24);
		this.ratePerMs = this.dailyLimit / 86_400_000;
		this.reserve = { ...QUOTA_RESERVE, ...(opts.reserve ?? {}) };
		this.pauseAfter429Ms = opts.pauseAfter429Ms ?? 5 * 60_000;
		this.now = opts.now ?? Date.now;
		this.lastRefill = this.now();
		// start half full: a restart must not open with a burst of an hour's requests
		this.tokens = this.capacity / 2;
		this.usage = { day: dayOf(this.lastRefill), dailyLimit: this.dailyLimit, requestsToday: 0, byPriority: emptyByPriority(), deniedToday: 0, rateLimitedToday: 0 };
	}

	private tick(): number {
		const t = this.now();
		const day = dayOf(t);
		if (day !== this.usage.day) {
			this.usage = { ...this.usage, day, requestsToday: 0, byPriority: emptyByPriority(), deniedToday: 0, rateLimitedToday: 0 };
		}
		if (t > this.lastRefill) {
			this.tokens = Math.min(this.capacity, this.tokens + (t - this.lastRefill) * this.ratePerMs);
			this.lastRefill = t;
		}
		return t;
	}

	/** Why `priority` may not take a request right now (undefined: it may). */
	private refusal(priority: QuotaPriority, t: number): string | undefined {
		if (priority === 'realtime') {
			if (this.usage.requestsToday >= this.hardLimit) return `hard daily limit of ${this.hardLimit} reached`;
			return this.tokens >= 1 ? undefined : 'bucket empty';
		}
		if (this.usage.requestsToday >= this.dailyLimit) return `daily limit of ${this.dailyLimit} reached`;
		if (t < this.pausedUntil) return 'paused after a 429';
		return this.tokens - 1 >= this.reserve[priority] * this.capacity ? undefined : 'reserved for higher priorities';
	}

	/** Takes one request for `priority` if the budget allows it now. */
	tryTake(priority: QuotaPriority): boolean {
		const t = this.tick();
		if (this.refusal(priority, t)) return false;
		this.tokens -= 1;
		this.usage.requestsToday++;
		this.usage.byPriority[priority]++;
		return true;
	}

	/**
	 * Waits (at most `maxWaitMs`) until `priority` may take a request and takes
	 * it; false when it may not within that time (counted as denied) or when a
	 * daily limit makes waiting pointless.
	 */
	async take(priority: QuotaPriority, maxWaitMs = 60_000): Promise<boolean> {
		const until = this.now() + Math.max(0, maxWaitMs);
		for (;;) {
			if (this.tryTake(priority)) return true;
			const t = this.now();
			const why = this.refusal(priority, t) ?? '';
			if (t >= until || why.includes('daily limit')) {
				this.usage.deniedToday++;
				return false;
			}
			const need = Math.max(1, (priority === 'realtime' ? 1 : this.reserve[priority] * this.capacity + 1) - this.tokens);
			const wait = t < this.pausedUntil && priority !== 'realtime' ? this.pausedUntil - t : need / this.ratePerMs;
			await sleep(Math.max(50, Math.min(30_000, wait, until - t)));
		}
	}

	/** Takes or throws QuotaDenied. */
	async require(priority: QuotaPriority, maxWaitMs = 60_000): Promise<void> {
		if (!(await this.take(priority, maxWaitMs))) throw new QuotaDenied(priority, this.refusal(priority, this.now()) ?? 'no capacity in time');
	}

	success(): void {
		const iso = new Date(this.tick()).toISOString();
		this.usage.lastSuccessAt = iso;
		delete this.usage.failingSince;
	}

	/** Records a failed request (`status` 429 pauses the lower priorities). */
	failure(status: number, message: string): void {
		const t = this.tick();
		const iso = new Date(t).toISOString();
		this.usage.lastFailureAt = iso;
		this.usage.lastError = message.slice(0, 200);
		this.usage.failingSince ??= iso;
		if (status === 429) {
			this.usage.last429At = iso;
			this.usage.rateLimitedToday++;
			this.pausedUntil = Math.max(this.pausedUntil, t + this.pauseAfter429Ms);
		}
	}

	snapshot(): QuotaUsage {
		this.tick();
		return { ...this.usage, byPriority: { ...this.usage.byPriority }, tokens: Math.floor(this.tokens), capacity: Math.round(this.capacity) };
	}

	/** Carries the counters of an earlier process over (same UTC day only), so a restart does not reset them. */
	restore(saved: Partial<QuotaUsage> | undefined): void {
		if (!saved) return;
		this.tick();
		if (saved.day === this.usage.day) {
			this.usage.requestsToday = Math.max(this.usage.requestsToday, Number(saved.requestsToday) || 0);
			for (const p of QUOTA_PRIORITIES) this.usage.byPriority[p] = Math.max(this.usage.byPriority[p], Number(saved.byPriority?.[p]) || 0);
			this.usage.deniedToday = Math.max(this.usage.deniedToday, Number(saved.deniedToday) || 0);
			this.usage.rateLimitedToday = Math.max(this.usage.rateLimitedToday, Number(saved.rateLimitedToday) || 0);
		}
		for (const k of ['lastSuccessAt', 'lastFailureAt', 'last429At', 'lastError', 'failingSince'] as const) {
			if (saved[k] && !this.usage[k]) this.usage[k] = saved[k];
		}
	}
}

/** MIDGARD_DAILY_LIMIT (default 40,000: 80 % of the free gateway's ~50,000 a day). */
export function midgardDailyLimitFromEnv(env: Record<string, string | undefined> = process.env): number {
	const n = Number(env.MIDGARD_DAILY_LIMIT ?? '');
	return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 40_000;
}
