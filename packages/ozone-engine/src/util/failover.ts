/**
 * JSON GETs against an ordered list of equivalent endpoints (Redacted's own
 * THORNode first, a public gateway as the fallback), each behind its own
 * client-side rate limit:
 *
 * - the first endpoint that is not cooling down is asked; a 429 or 503 is
 *   retried once on the same endpoint after the time it asks for (bounded),
 *   then the endpoint cools down (30 s, doubling up to 10 min) and the next
 *   one is asked;
 * - a network error, a timeout or another 5xx cools the endpoint down at once;
 * - any other 4xx is not the endpoint's fault for every path (a node without
 *   an index answers 4xx/501 where another serves the path): the next one is
 *   asked, without a cool-down;
 * - an endpoint that does not hold the requested heights (`floor`: a node
 *   restored from a state-sync snapshot starts at that height) is skipped
 *   for requests that need older heights.
 *
 * When every endpoint is cooling down the one that recovers first is asked
 * anyway: a request is never refused without trying.
 */
import { httpJson, HttpError, RateLimiter, type HttpOptions } from './http.js';

export interface EndpointStatus {
	url: string;
	requests: number;
	failures: number;
	lastSuccessAt?: string;
	lastFailureAt?: string;
	last429At?: string;
	lastError?: string;
	/** Cooling down until (ISO), after failures. */
	downUntil?: string;
	/** Oldest height it serves, when known. */
	floor?: number;
}

export interface FailoverOptions {
	urls: string[];
	/** Minimum interval between requests to one endpoint (default 200 ms = 5 requests/s). */
	minIntervalMs?: number;
	/** Per-endpoint overrides of minIntervalMs (by URL prefix). */
	intervals?: Record<string, number>;
	concurrency?: number;
	timeoutMs?: number;
	http?: HttpOptions;
	cooldownMs?: number;
	maxCooldownMs?: number;
	/** Longest Retry-After honoured before retrying the same endpoint (default 10 s). */
	maxRetryAfterMs?: number;
	now?: () => number;
}

interface Endpoint {
	url: string;
	limiter: RateLimiter;
	status: EndpointStatus;
	downUntilMs: number;
	cooldownMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trimSlash = (u: string) => u.replace(/\/+$/, '');

export class FailoverJson {
	private readonly endpoints: Endpoint[];
	private readonly opts: FailoverOptions;
	private readonly now: () => number;

	constructor(opts: FailoverOptions) {
		if (!opts.urls.length) throw new Error('FailoverJson: no endpoint');
		this.opts = opts;
		this.now = opts.now ?? Date.now;
		const seen = new Set<string>();
		this.endpoints = [];
		for (const raw of opts.urls) {
			const url = trimSlash(raw);
			if (!url || seen.has(url)) continue;
			seen.add(url);
			const interval = Object.entries(opts.intervals ?? {}).find(([prefix]) => url.startsWith(trimSlash(prefix)))?.[1] ?? opts.minIntervalMs ?? 200;
			this.endpoints.push({ url, limiter: new RateLimiter(interval, opts.concurrency ?? 1), status: { url, requests: 0, failures: 0 }, downUntilMs: 0, cooldownMs: 0 });
		}
	}

	get urls(): string[] {
		return this.endpoints.map((e) => e.url);
	}

	/** Records the oldest height an endpoint serves (from its node status). */
	setFloor(url: string, floor: number | undefined): void {
		const e = this.endpoints.find((x) => x.url === trimSlash(url));
		if (e) e.status.floor = floor && floor > 0 ? floor : undefined;
	}

	status(): EndpointStatus[] {
		return this.endpoints.map((e) => ({ ...e.status, ...(e.downUntilMs > this.now() ? { downUntil: new Date(e.downUntilMs).toISOString() } : {}) }));
	}

	private order(minHeight?: number): Endpoint[] {
		const usable = this.endpoints.filter((e) => minHeight === undefined || !e.status.floor || e.status.floor <= minHeight);
		const list = usable.length ? usable : this.endpoints;
		const t = this.now();
		const up = list.filter((e) => e.downUntilMs <= t);
		const down = list.filter((e) => e.downUntilMs > t).sort((a, b) => a.downUntilMs - b.downUntilMs);
		return up.length ? [...up, ...down] : down.slice(0, 1).concat(down.slice(1));
	}

	private coolDown(e: Endpoint, error: string, status = 0): void {
		const t = this.now();
		e.status.failures++;
		e.status.lastFailureAt = new Date(t).toISOString();
		e.status.lastError = error.slice(0, 200);
		if (status === 429) e.status.last429At = e.status.lastFailureAt;
		e.cooldownMs = Math.min(this.opts.maxCooldownMs ?? 600_000, e.cooldownMs ? e.cooldownMs * 2 : (this.opts.cooldownMs ?? 30_000));
		e.downUntilMs = t + e.cooldownMs;
	}

	/**
	 * GET `pathAndQuery` (starting with `/`) as JSON from the first endpoint
	 * that answers. `minHeight`: the request needs heights at or above it.
	 */
	async get<T>(pathAndQuery: string, opts: { minHeight?: number; timeoutMs?: number } = {}): Promise<T> {
		let last: unknown;
		// another pass over the list after a pause, while a failure was transient (default one more; http.retries overrides)
		const passes = 1 + Math.max(0, this.opts.http?.retries ?? 1);
		for (let pass = 0; pass < passes; pass++) {
			let transient = false;
			for (const e of this.order(opts.minHeight)) {
				const r = await this.tryEndpoint<T>(e, pathAndQuery, opts.timeoutMs);
				if (r.ok) return r.body;
				last = r.error;
				transient ||= r.transient;
			}
			if (!transient || pass === passes - 1) break;
			await sleep(1000 * 2 ** pass);
		}
		throw last instanceof Error ? last : new Error(String(last));
	}

	private async tryEndpoint<T>(e: Endpoint, pathAndQuery: string, timeoutMs?: number): Promise<{ ok: true; body: T } | { ok: false; error: unknown; transient: boolean }> {
		let last: unknown;
		{
			for (let attempt = 0; attempt < 2; attempt++) {
				e.status.requests++;
				try {
					const body = await e.limiter.run(() =>
						httpJson<T>(`${e.url}${pathAndQuery}`, { timeoutMs: timeoutMs ?? this.opts.timeoutMs ?? 60_000, ...this.opts.http, retries: 0 })
					);
					e.status.lastSuccessAt = new Date(this.now()).toISOString();
					e.cooldownMs = 0;
					e.downUntilMs = 0;
					return { ok: true, body };
				} catch (err) {
					last = err;
					const status = err instanceof HttpError ? err.status : 0;
					if ((status === 429 || status === 503) && attempt === 0) {
						const after = (err as HttpError & { retryAfterMs?: number }).retryAfterMs ?? 2_000;
						e.status.lastError = `HTTP ${status}`;
						if (status === 429) e.status.last429At = new Date(this.now()).toISOString();
						await sleep(Math.min(this.opts.maxRetryAfterMs ?? 10_000, after));
						continue;
					}
					if (status >= 400 && status < 500 && status !== 429) {
						// not this endpoint's fault for every path: ask the next one without a cool-down
						e.status.lastError = `HTTP ${status}`;
						return { ok: false, error: err, transient: false };
					}
					this.coolDown(e, (err as Error).message ?? String(err), status);
					return { ok: false, error: err, transient: true };
				}
			}
		}
		return { ok: false, error: last, transient: true };
	}
}
