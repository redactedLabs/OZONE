/**
 * Per-host request budgets for public explorer APIs, shared by every job in
 * the process (the cluster expansion and the THORChain inbound watcher use
 * the same hosts and must not add up past a host's limits):
 *
 * - pacing: at most one request at a time, `minIntervalMs` apart;
 * - an optional quota: at most `perWindow` requests per `windowMs` (e.g. a
 *   keyless Blockscout instance allows 10 requests per IP and hour, measured
 *   2026-09-28; routescan 10,000 a day);
 * - a host that answers 429 is blocked for its reset time.
 *
 * A spent quota or a blocked host fails fast with QuotaExceeded instead of
 * waiting: callers record what they skipped (and resume later) rather than
 * hanging a job for an hour.
 */
import { RateLimiter } from '../util/http.js';

export class QuotaExceeded extends Error {
	constructor(
		readonly host: string,
		readonly retryAt: number
	) {
		super(`${host}: request quota spent until ${new Date(retryAt).toISOString()}`);
		this.name = 'QuotaExceeded';
	}
}

export interface HostPolicy {
	/** Minimum gap between two requests to the host. */
	minIntervalMs: number;
	/** Requests allowed per window (unset: no quota). */
	perWindow?: number;
	windowMs?: number;
}

export class HostBudget {
	private readonly pacer: RateLimiter;
	private windowStart = 0;
	private used = 0;
	private blockedUntil = 0;
	/** Requests sent through this budget since the process started. */
	requests = 0;

	constructor(
		readonly host: string,
		readonly policy: HostPolicy,
		private readonly now: () => number = Date.now
	) {
		this.pacer = new RateLimiter(policy.minIntervalMs, 1);
	}

	private roll(): void {
		const t = this.now();
		if (this.policy.windowMs && t - this.windowStart >= this.policy.windowMs) {
			this.windowStart = t;
			this.used = 0;
		}
	}

	/** Requests left in the current window (Infinity without a quota; 0 while blocked). */
	remaining(): number {
		this.roll();
		if (this.now() < this.blockedUntil) return 0;
		return this.policy.perWindow === undefined ? Infinity : Math.max(0, this.policy.perWindow - this.used);
	}

	/** When the next request may be sent, if it may not be sent now. */
	retryAt(): number {
		const t = this.now();
		if (t < this.blockedUntil) return this.blockedUntil;
		return this.windowStart + (this.policy.windowMs ?? 0);
	}

	/** The host answered 429 (or said "rate limit"): no more requests until `untilMs`. */
	block(untilMs: number): void {
		this.blockedUntil = Math.max(this.blockedUntil, untilMs);
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.remaining() <= 0) throw new QuotaExceeded(this.host, this.retryAt());
		this.used++;
		this.requests++;
		return this.pacer.run(fn);
	}
}

const budgets = new Map<string, HostBudget>();

/** The process-wide budget of a host (created with `policy` the first time). */
export function hostBudget(host: string, policy: HostPolicy): HostBudget {
	let b = budgets.get(host);
	if (!b) {
		b = new HostBudget(host, policy);
		budgets.set(host, b);
	}
	return b;
}

/** Requests per host so far (metrics). */
export function hostRequests(): Record<string, number> {
	return Object.fromEntries([...budgets.values()].map((b) => [b.host, b.requests]));
}

/** Tests: forget every budget. */
export function resetHostBudgets(): void {
	budgets.clear();
}

/** Tests (and deployments with a paid plan): replace a host's policy. */
export function configureHost(host: string, policy: HostPolicy): HostBudget {
	const b = new HostBudget(host, policy);
	budgets.set(host, b);
	return b;
}
