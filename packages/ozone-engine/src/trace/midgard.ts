/**
 * Midgard (THORChain indexer) client for tracing.
 *
 * Facts that shape this client (measured against the Liquify gateway,
 * THORNode 3.20.3, 2026-09):
 * - the `address` filter is case-sensitive: EVM senders are stored
 *   lower-case, but memo destinations keep the case the user typed (usually
 *   EIP-55). Forward tracing queries the sender form (see queryForms);
 * - multi-address queries (`address=a,b`) time out at the gateway, so every
 *   address is queried on its own;
 * - a page is always sorted newest first; `nextPageToken` continues with
 *   OLDER actions, `prevPageToken` with NEWER ones;
 * - `fromHeight=H` is inclusive and returns the `limit` OLDEST actions at or
 *   after H (not the newest ones). Following `nextPageToken` from such a page
 *   goes below H and returns nothing, so a forward read must continue with
 *   `prevPageToken` (measured 2026-09-27: an address with 12 actions, limit 5,
 *   fromHeight=1 → its 5 oldest; nextPageToken → none; prevPageToken → the
 *   next 5 newer).
 */
import { httpJson, RateLimiter, type HttpOptions } from '../util/http.js';

export const DEFAULT_MIDGARD_URL = 'https://gateway.liquify.com/chain/thorchain_midgard';

export interface MidgardCoin {
	asset: string;
	amount: string;
}

export interface MidgardTx {
	address: string;
	coins: MidgardCoin[];
	txID: string;
	height?: string;
	affiliate?: boolean;
}

export interface MidgardAction {
	date: string; // ns
	height: string;
	in: MidgardTx[];
	out: MidgardTx[];
	pools: string[];
	status: string;
	type: string;
	metadata: Record<string, Record<string, unknown> | undefined>;
}

export interface ActionsPage {
	actions: MidgardAction[];
	/** Continues with older actions. */
	nextPageToken?: string;
	/** Continues with newer actions. */
	prevPageToken?: string;
}

/** Actions per page (Midgard's maximum). */
export const PAGE_SIZE = 50;

/**
 * Where a bounded forward read stopped: `complete` when the newest action
 * was reached; otherwise `resumeHeight` is the height to read again from
 * (inclusive) — the newest height that may not have been read completely.
 */
export interface ForwardRead {
	complete: boolean;
	resumeHeight?: number;
}

export interface MidgardOptions {
	baseUrl?: string;
	/** Minimum interval between requests (default 350 ms ≈ 3 req/s). */
	minIntervalMs?: number;
	concurrency?: number;
	http?: HttpOptions;
}

export class Midgard {
	readonly baseUrl: string;
	private readonly limiter: RateLimiter;
	requests = 0;

	constructor(private readonly opts: MidgardOptions = {}) {
		this.baseUrl = (opts.baseUrl ?? DEFAULT_MIDGARD_URL)
			.replace(/\/+$/, '')
			.replace('https://midgard.ninerealms.com', DEFAULT_MIDGARD_URL);
		this.limiter = new RateLimiter(opts.minIntervalMs ?? 350, opts.concurrency ?? 2);
	}

	async actions(params: Record<string, string | number | undefined>): Promise<ActionsPage> {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
		const url = `${this.baseUrl}/v2/actions?${q.toString()}`;
		this.requests++;
		const body = await this.limiter.run(() =>
			httpJson<{ actions?: MidgardAction[]; meta?: { nextPageToken?: string; prevPageToken?: string } }>(url, {
				timeoutMs: 75_000,
				retries: 3,
				...this.opts.http
			})
		);
		return {
			actions: body.actions ?? [],
			nextPageToken: body.meta?.nextPageToken || undefined,
			prevPageToken: body.meta?.prevPageToken || undefined
		};
	}

	/**
	 * Every action involving `address` (as sender or recipient) at or after
	 * `fromHeight` (inclusive; whole history when unset), OLDEST FIRST, at
	 * most `maxPages` pages. `progress` (when given) is filled in when the
	 * generator finishes: `complete` once the newest action was read,
	 * otherwise where to resume.
	 */
	async *actionsForAddress(
		address: string,
		opts: { fromHeight?: number; maxPages?: number; progress?: ForwardRead } = {}
	): AsyncGenerator<MidgardAction> {
		yield* readForward((p) => this.actions({ address, ...p }), opts.fromHeight, opts.maxPages ?? 400, opts.progress);
	}

	/**
	 * Actions newer than `afterHeight`, oldest first (for the real-time
	 * follower), read forward from the cursor: a follower that fell behind
	 * catches up in chain order over several calls and never skips a range.
	 * `complete` tells whether the newest action was reached; if not,
	 * `resumeAfter` is the height up to which every action was returned (the
	 * newest page may end in the middle of a height).
	 */
	async actionsSince(
		afterHeight: number,
		maxPages = 40
	): Promise<{ actions: MidgardAction[]; complete: boolean; head: number; resumeAfter?: number }> {
		const progress: ForwardRead = { complete: false };
		const out: MidgardAction[] = [];
		for await (const a of readForward((p) => this.actions(p), afterHeight + 1, maxPages, progress)) {
			if (Number(a.height) > afterHeight) out.push(a);
		}
		const head = Math.max(afterHeight, ...out.map((a) => Number(a.height)));
		if (progress.complete) return { actions: out, complete: true, head };
		return { actions: out, complete: false, head, resumeAfter: Math.max(afterHeight, (progress.resumeHeight ?? afterHeight + 1) - 1) };
	}

	async pools(): Promise<Array<{ asset: string; assetPriceUSD: string; status: string }>> {
		this.requests++;
		return this.limiter.run(() =>
			httpJson<Array<{ asset: string; assetPriceUSD: string; status: string }>>(`${this.baseUrl}/v2/pools?status=available`, {
				timeoutMs: 60_000,
				...this.opts.http
			})
		);
	}

	async runePriceUsd(): Promise<number> {
		this.requests++;
		const s = await this.limiter.run(() =>
			httpJson<{ runePriceUSD?: string }>(`${this.baseUrl}/v2/stats`, { timeoutMs: 60_000, ...this.opts.http })
		);
		return Number(s.runePriceUSD ?? 0);
	}
}

/**
 * Reads a Midgard action stream forward in chain order: the first page from
 * `fromHeight` (the oldest actions at or after it; the whole history when
 * unset), then `prevPageToken` (newer) until a page is not full. Midgard
 * sorts every page newest first; each page is yielded oldest first.
 */
export async function* readForward(
	fetchPage: (params: Record<string, string | number | undefined>) => Promise<ActionsPage>,
	fromHeight: number | undefined,
	maxPages: number,
	progress?: ForwardRead
): AsyncGenerator<MidgardAction> {
	let page = await fetchPage({ limit: PAGE_SIZE, fromHeight: fromHeight && fromHeight > 0 ? fromHeight : 1 });
	for (let n = 1; ; n++) {
		const ascending = [...page.actions].sort((a, b) => Number(a.height) - Number(b.height));
		for (const a of ascending) yield a;
		if (page.actions.length < PAGE_SIZE) {
			if (progress) {
				progress.complete = true;
				delete progress.resumeHeight;
			}
			return;
		}
		if (n >= Math.max(1, maxPages) || !page.prevPageToken) {
			// Budget spent (or no way forward): the newest height of this page may
			// continue on the next one, so it is where a later read resumes.
			if (progress) {
				progress.complete = false;
				progress.resumeHeight = Number(ascending[ascending.length - 1].height);
			}
			return;
		}
		page = await fetchPage({ limit: PAGE_SIZE, prevPageToken: page.prevPageToken });
	}
}

/** What tracing needs from Midgard (lets tests and alternative indexers plug in). */
export type MidgardLike = Pick<Midgard, 'actions' | 'actionsForAddress' | 'actionsSince' | 'pools' | 'runePriceUsd'>;
