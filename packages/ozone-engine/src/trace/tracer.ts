/**
 * THORChain flow tracing.
 *
 * Starting from listed addresses (hop 0), every THORChain flow out of a
 * flagged address flags its recipient, with a reason that names the origin
 * list, the action and the THORChain transaction. Precision rules:
 *
 * - **hop limit** (default 3) — beyond it nothing is flagged;
 * - **decay** — traced risk is capped at `high` (never `severe`, which is
 *   reserved for official listings) and drops one level per extra hop;
 * - **amount thresholds** — flows under the dust limit (default $50) are
 *   ignored (dusting resistance); hop-1 flows under $1,000 and deeper flows
 *   under $5,000 lose one more level;
 * - **ownership links** (LP pairing, THORName aliases) keep the hop of the
 *   flagged owner: they are the same actor, not a new counterparty;
 * - **time** — a traced address only propagates flows that happen after it
 *   received the tainted value;
 * - services (addresses with very large activity) never propagate.
 */
import { riskFromRank, riskRank, type Category, type Risk } from '../../../ozone-client/src/index.js';
import { extractFlows, type Flow, type Relation } from './flows.js';
import type { MidgardAction } from './midgard.js';
import type { PriceOracle } from './prices.js';

export interface TraceConfig {
	maxHops: number;
	dustUsd: number;
	hop1FullUsd: number;
	deepFullUsd: number;
}

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
	maxHops: 3,
	dustUsd: 50,
	hop1FullUsd: 1_000,
	deepFullUsd: 5_000
};

/** A flagged address as the tracer sees it. */
export interface IndexEntry {
	key: string;
	/** 0 = listed; n = traced n hops from a listed address. */
	hop: number;
	/** Risk of the listed origin (what decays with hops). */
	originRisk: Risk;
	originKey: string;
	originSource: string;
	originEntity?: string;
	originCategory: Category;
	/** Only flows strictly after this THORChain height count. */
	since?: number;
	/**
	 * Only flows at or after this time (unix seconds) count — for addresses
	 * tainted by a dated incident, e.g. hack-cluster members from the start
	 * of the hack. Earlier activity cannot be the proceeds.
	 */
	sinceTime?: number;
	service?: boolean;
}

export interface TraceHit extends Flow {
	hop: number;
	risk: Risk;
	originKey: string;
	originSource: string;
	originEntity?: string;
	originRisk: Risk;
	originCategory: Category;
}

/**
 * A value flow under the dust limit on its own. It flags nothing by itself,
 * but is kept (once per THORChain transaction, see store/trace.ts
 * recordDustFlows) so that many of them from the same origin to the same
 * recipient still add up.
 */
export interface DustFlow extends Flow {
	usd: number;
	hop: number;
	originKey: string;
	originSource: string;
	originEntity?: string;
	originRisk: Risk;
	originCategory: Category;
}

const ORIGIN_CATEGORIES: ReadonlySet<Category> = new Set([
	'sanctions',
	'law_enforcement',
	'hack',
	'exploit',
	'stablecoin_freeze',
	'phishing',
	'scam',
	'manual'
]);

export function isTraceOrigin(category: Category): boolean {
	return ORIGIN_CATEGORIES.has(category);
}

/** Risk of a traced address, or null when the flow must not flag anything. */
export function traceRisk(
	originRisk: Risk,
	hop: number,
	usd: number | undefined,
	relation: Relation,
	cfg: TraceConfig = DEFAULT_TRACE_CONFIG
): Risk | null {
	if (hop < 1 || hop > cfg.maxHops) return null;
	let rank = Math.min(riskRank(originRisk), riskRank('high')) - (hop - 1);
	if (relation === 'value' && usd !== undefined) {
		if (usd < cfg.dustUsd) return null;
		if (usd < (hop === 1 ? cfg.hop1FullUsd : cfg.deepFullUsd)) rank -= 1;
	}
	if (rank < riskRank('low')) return null;
	return riskFromRank(rank);
}

/**
 * Flows of one action that leave a flagged address. `onDust`, when given,
 * is called for value flows under the dust limit that flag nothing on their
 * own, so a caller can accumulate them (see store/trace.ts recordDustFlows)
 * — many such flows from the same origin to the same recipient still add up.
 * They pass every rule a flagging flow passes (signed by a flagged sender,
 * after its taint, not a service, not to a listed address) and are only
 * reported where a large enough total could flag anything at that hop.
 */
export function traceAction(
	action: MidgardAction,
	lookup: (key: string) => IndexEntry | undefined,
	prices?: PriceOracle,
	cfg: TraceConfig = DEFAULT_TRACE_CONFIG,
	onDust?: (dust: DustFlow) => void
): TraceHit[] {
	const hits: TraceHit[] = [];
	for (const flow of extractFlows(action, prices)) {
		const src = lookup(flow.fromKey);
		if (!src || src.service) continue;
		if (src.since !== undefined && flow.height <= src.since) continue;
		if (src.sinceTime !== undefined && Date.parse(flow.date) / 1000 < src.sinceTime) continue;
		const target = lookup(flow.toKey);
		if (target && target.hop === 0) continue; // already listed in its own right
		const hop = flow.relation === 'value' ? src.hop + 1 : Math.max(1, src.hop);
		const risk = traceRisk(src.originRisk, hop, flow.usd, flow.relation, cfg);
		if (!risk) {
			if (
				onDust &&
				flow.relation === 'value' &&
				flow.usd !== undefined &&
				flow.usd > 0 &&
				flow.usd < cfg.dustUsd &&
				// the undemoted risk at this hop: null past the hop limit, or when
				// even a large total from this origin would flag nothing
				traceRisk(src.originRisk, hop, undefined, 'value', cfg)
			) {
				onDust({
					...flow,
					usd: flow.usd,
					hop,
					originKey: src.originKey,
					originSource: src.originSource,
					...(src.originEntity ? { originEntity: src.originEntity } : {}),
					originRisk: src.originRisk,
					originCategory: src.originCategory
				});
			}
			continue;
		}
		hits.push({
			...flow,
			hop,
			risk,
			originKey: src.originKey,
			originSource: src.originSource,
			...(src.originEntity ? { originEntity: src.originEntity } : {}),
			originRisk: src.originRisk,
			originCategory: src.originCategory
		});
	}
	return hits;
}

const RELATION_TEXT: Record<Relation, string> = {
	value: 'received',
	lp_pair: 'co-owns a THORChain liquidity position with',
	thorname: 'is linked by a THORName to'
};

/** Human-readable reason for a hit. */
export function describeHit(h: TraceHit): string {
	const origin = h.originEntity ? `${h.originEntity} (${h.originSource})` : h.originSource;
	const via = h.action === 'swap' ? 'THORChain swap' : `THORChain ${h.action}`;
	const date = h.date.slice(0, 10);
	if (h.relation !== 'value') {
		return `${RELATION_TEXT[h.relation]} ${h.fromAddress}, flagged via ${origin}; ${via} ${h.txid} on ${date}`;
	}
	const amount = h.amount ? `${h.amount}${h.usd ? ` (~$${Math.round(h.usd).toLocaleString('en-US')})` : ''}` : 'value';
	const hopText = h.hop === 1 ? `from ${h.fromAddress}, listed by ${origin}` : `from ${h.fromAddress} (${h.hop - 1} hop${h.hop > 2 ? 's' : ''} from ${origin})`;
	return `Received ${amount} ${hopText} via ${via} ${h.txid} on ${date}`;
}
