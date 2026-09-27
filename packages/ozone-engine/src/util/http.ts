/**
 * Polite HTTP for public data sources: timeouts, bounded retries with
 * backoff on 429/5xx/network errors, response size limits and an honest
 * User-Agent. No credentials are ever sent.
 */
export const USER_AGENT = 'OzoneCompliance/2.0 (+https://github.com/redactedLabs/OZONE)';

export interface HttpOptions {
	fetch?: typeof fetch;
	timeoutMs?: number;
	retries?: number;
	maxBytes?: number;
	headers?: Record<string, string>;
	method?: string;
	body?: string;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
		message: string
	) {
		super(message);
		this.name = 'HttpError';
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpBytes(url: string, opts: HttpOptions = {}): Promise<Uint8Array> {
	const fetchImpl = opts.fetch ?? fetch;
	const retries = opts.retries ?? 3;
	const maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
	let lastErr: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
		try {
			const res = await fetchImpl(url, {
				method: opts.method ?? 'GET',
				body: opts.body,
				redirect: 'follow',
				signal: controller.signal,
				headers: { 'user-agent': USER_AGENT, ...(opts.headers ?? {}) }
			});
			if (!res.ok) {
				// An unread error body keeps its connection busy: release it.
				await res.body?.cancel().catch(() => undefined);
			}
			if (res.status === 429 || res.status >= 500) {
				const err = new HttpError(res.status, url, `HTTP ${res.status}`);
				// a rate-limited client waits as long as the server asks (bounded)
				const after = Number(res.headers.get('retry-after'));
				if (res.status === 429 && Number.isFinite(after) && after > 0) (err as HttpError & { retryAfterMs?: number }).retryAfterMs = Math.min(60_000, after * 1000);
				throw err;
			}
			if (!res.ok) {
				// 4xx other than 429 is not retried
				const err = new HttpError(res.status, url, `HTTP ${res.status}`);
				(err as HttpError & { fatal?: boolean }).fatal = true;
				throw err;
			}
			const buf = new Uint8Array(await res.arrayBuffer());
			if (buf.length > maxBytes) throw new Error(`Response too large (${buf.length} bytes)`);
			return buf;
		} catch (e) {
			lastErr = e;
			if ((e as { fatal?: boolean }).fatal) throw e;
			if (attempt < retries) {
				const retryAfter = e instanceof HttpError && e.status === 429 ? ((e as HttpError & { retryAfterMs?: number }).retryAfterMs ?? 5000) : 0;
				await sleep(Math.max(retryAfter, 1000 * 2 ** attempt));
			}
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
	return Buffer.from(await httpBytes(url, opts)).toString('utf8');
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
	const text = await httpText(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } });
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`Invalid JSON from ${url.split('?')[0]}`);
	}
}

/**
 * Serializes requests to one host with a minimum interval between them
 * (e.g. 250 ms = at most 4 requests per second) and bounded concurrency.
 */
export class RateLimiter {
	private last = 0;
	private active = 0;
	private readonly queue: Array<() => void> = [];

	constructor(
		private readonly minIntervalMs: number,
		private readonly concurrency = 1
	) {}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= this.concurrency) {
			await new Promise<void>((resolve) => this.queue.push(resolve));
		}
		this.active++;
		try {
			const wait = this.last + this.minIntervalMs - Date.now();
			if (wait > 0) await sleep(wait);
			this.last = Date.now();
			return await fn();
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}
}
