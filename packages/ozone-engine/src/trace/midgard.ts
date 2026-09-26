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
 * - pagination is by `nextPageToken` (newest first).
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
	nextPageToken?: string;
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
			httpJson<{ actions?: MidgardAction[]; meta?: { nextPageToken?: string } }>(url, {
				timeoutMs: 75_000,
				retries: 3,
				...this.opts.http
			})
		);
		return { actions: body.actions ?? [], nextPageToken: body.meta?.nextPageToken || undefined };
	}

	/**
	 * Every action involving `address` (as sender or recipient), newest
	 * first, optionally only those newer than `fromHeight`.
	 */
	async *actionsForAddress(address: string, opts: { fromHeight?: number; maxPages?: number } = {}): AsyncGenerator<MidgardAction> {
		let token: string | undefined;
		const maxPages = opts.maxPages ?? 400;
		for (let page = 0; page < maxPages; page++) {
			const res = await this.actions({
				address,
				limit: 50,
				nextPageToken: token,
				fromHeight: opts.fromHeight && opts.fromHeight > 0 ? opts.fromHeight : undefined
			});
			for (const a of res.actions) yield a;
			if (!res.nextPageToken || res.actions.length < 50) return;
			token = res.nextPageToken;
		}
	}

	/**
	 * Actions newer than `afterHeight`, oldest first (for the real-time
	 * follower). Stops after `maxPages` pages; `complete` tells whether the
	 * cursor was reached.
	 */
	async actionsSince(afterHeight: number, maxPages = 40): Promise<{ actions: MidgardAction[]; complete: boolean; head: number }> {
		const out: MidgardAction[] = [];
		let token: string | undefined;
		let head = afterHeight;
		for (let page = 0; page < maxPages; page++) {
			const res = await this.actions({ limit: 50, nextPageToken: token });
			let reached = false;
			for (const a of res.actions) {
				const h = Number(a.height);
				head = Math.max(head, h);
				if (h <= afterHeight) {
					reached = true;
					continue;
				}
				out.push(a);
			}
			if (reached || !res.nextPageToken || res.actions.length === 0) {
				return { actions: out.reverse(), complete: true, head };
			}
			token = res.nextPageToken;
		}
		return { actions: out.reverse(), complete: false, head };
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

/** What tracing needs from Midgard (lets tests and alternative indexers plug in). */
export type MidgardLike = Pick<Midgard, 'actions' | 'actionsForAddress' | 'actionsSince' | 'pools' | 'runePriceUsd'>;
