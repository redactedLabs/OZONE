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
 * - **amount thresholds** — flows under the dust limit (default $50) flag
 *   nothing on their own (dusting resistance); hop-1 flows under $1,000 and
 *   deeper flows under $5,000 lose one more level;
 * - **small transfers add up** — value from the same origin to the same
 *   recipient at the same hop is summed, each THORChain transaction once: a
 *   recipient whose total of sub-dust transfers reaches the dust limit is
 *   traced like one flow of that total (store/trace.ts recordDustFlows), and
 *   at most `maxDustRecipients` such recipients per origin and hop are
 *   followed onward (the rest are published, not traced further);
 * - **ownership links** (LP pairing, THORName aliases) keep the hop of the
 *   flagged owner: they are the same actor, not a new counterparty;
 * - **time** — a traced address only propagates flows that happen after it
 *   received the tainted value;
 * - services (addresses with very large activity) never propagate.
 */
import { riskFromRank, riskRank, type Category, type Risk } from '../../../ozone-client/src/index.js';
import { CONTRACT_ACTION, THORCHAIN_MODULES, extractFlows, type Flow, type Relation } from './flows.js';
import type { MidgardAction } from './midgard.js';
import type { PriceOracle } from './prices.js';

export interface TraceConfig {
	maxHops: number;
	dustUsd: number;
	hop1FullUsd: number;
	deepFullUsd: number;
	/**
	 * Fan-out cap for the small-transfer path: per listed origin and hop, at
	 * most this many recipients traced only by a total of sub-dust transfers
	 * are followed onward (queued for their own history). Further ones are
	 * still published with their reason, but not traced further, and logged.
	 */
	maxDustRecipients: number;
}

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
	maxHops: 3,
	dustUsd: 50,
	hop1FullUsd: 1_000,
	deepFullUsd: 5_000,
	maxDustRecipients: 100
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
	/**
	 * Listed through the incident path (a maintainer flag marked urgent, e.g.
	 * a hack announced today), or traced from such a listing: checked before
	 * anything else.
	 */
	urgent?: boolean;
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

/** Action label (and, as `TRACE_SMALL_TRANSFERS`, reason code) of a small-transfer total. */
export const SMALL_TRANSFERS = 'small_transfers';

/**
 * Sub-dust transfers from one origin to one recipient at one hop, each
 * counted once (store/trace.ts loadDustGroups). Once `usd` reaches the dust
 * limit the recipient is traced as if it had received one flow of that total.
 */
export interface SmallTransferTotal {
	originKey: string;
	toKey: string;
	toAddress: string;
	toChain: string;
	hop: number;
	/** Transfers counted. */
	count: number;
	usd: number;
	/** Distinct sending addresses. */
	senders: string[];
	/** The strongest origin among the transfers (what decays with hops) and its provenance. */
	originRisk: Risk;
	originSource: string;
	originEntity?: string;
	originCategory: Category;
	firstDate: string;
	lastDate: string;
	/** The transfer with which the running total reached the dust limit (unset while below it). */
	crossing?: { txid: string; height: number; date: string; action: string; fromKey: string; fromAddress: string; fromChain: string };
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
 * A THORChain account that signed a payment to a listed address (a swap
 * whose destination is that address, a secured-asset withdrawal to it, …): the
 * account is linked to the listed address (screen/users.ts flags it one risk
 * level lower). Found from the listed side, so it does not depend on the
 * account being monitored.
 */
export interface PayerLink {
	thorAddress: string;
	listedKey: string;
	address: string;
	chain: string;
	txid: string;
	height: number;
	action: string;
}

/**
 * Flows of one action that leave a flagged address. `onDust`, when given,
 * is called for value flows under the dust limit that flag nothing on their
 * own, so a caller can accumulate them (see store/trace.ts recordDustFlows)
 * — many such flows from the same origin to the same recipient still add up.
 * They pass every rule a flagging flow passes (signed by a flagged sender,
 * after its taint, not a service, not to a listed address) and are only
 * reported where a large enough total could flag anything at that hop.
 * `onLink`, when given, is called for a THORChain account's payment to a
 * listed address (see PayerLink).
 */
export function traceAction(
	action: MidgardAction,
	lookup: (key: string) => IndexEntry | undefined,
	prices?: PriceOracle,
	cfg: TraceConfig = DEFAULT_TRACE_CONFIG,
	onDust?: (dust: DustFlow) => void,
	onLink?: (link: PayerLink) => void
): TraceHit[] {
	return traceFlows(extractFlows(action, prices), lookup, cfg, onDust, onLink);
}

/** The per-flow rules of traceAction, for flows from any source (Midgard actions, chain transaction events). */
export function traceFlows(
	flows: Flow[],
	lookup: (key: string) => IndexEntry | undefined,
	cfg: TraceConfig = DEFAULT_TRACE_CONFIG,
	onDust?: (dust: DustFlow) => void,
	onLink?: (link: PayerLink) => void
): TraceHit[] {
	const hits: TraceHit[] = [];
	for (const flow of flows) {
		const target = lookup(flow.toKey);
		if (
			onLink &&
			flow.relation === 'value' &&
			target &&
			target.hop === 0 &&
			target.key === target.originKey && // the listing itself, not a same-key twin
			!flow.toKey.startsWith('thor:') && // links are L1 addresses (a payment to a listed thor1 account is not one)
			flow.fromKey.startsWith('thor:') &&
			flow.fromAddress.length <= 50 && // an account, not a 32-byte contract
			!THORCHAIN_MODULES.has(flow.fromAddress)
		) {
			onLink({ thorAddress: flow.fromAddress, listedKey: target.key, address: flow.toAddress, chain: flow.toChain, txid: flow.txid, height: flow.height, action: flow.action });
		}
		const src = lookup(flow.fromKey);
		if (!src || src.service) continue;
		if (src.since !== undefined && flow.height <= src.since) continue;
		if (src.sinceTime !== undefined && Date.parse(flow.date) / 1000 < src.sinceTime) continue;
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

/**
 * Actions of the THORChain inbound watcher (trace/watcher.ts): an L1
 * transfer that funded an address one or two hops before it deposited into
 * THORChain. `txid` is the L1 transaction, not a THORChain one.
 */
export const L1_FUNDING_ACTIONS: ReadonlySet<string> = new Set(['l1_funding', 'l1_funding2']);

/** What moved the value, in a reason's words. */
function viaText(h: { action: string; fromChain: string }): string {
	const fromThor = h.fromChain === 'THOR';
	switch (h.action) {
		case 'swap':
			return 'THORChain swap';
		case 'secure':
			return fromThor ? 'THORChain secured-asset withdrawal (SECURE-)' : 'THORChain secured-asset deposit (SECURE+)';
		case 'trade':
			return fromThor ? 'THORChain trade-account withdrawal (TRADE-)' : 'THORChain trade-account deposit (TRADE+)';
		case 'limit_swap':
			return 'THORChain limit swap';
		case CONTRACT_ACTION:
			return 'a CosmWasm contract call on THORChain (transaction events)';
		default:
			return `THORChain ${h.action}`;
	}
}

/** Human-readable reason for a hit. */
export function describeHit(h: TraceHit): string {
	const origin = h.originEntity ? `${h.originEntity} (${h.originSource})` : h.originSource;
	const date = h.date.slice(0, 10);
	if (h.action === 'l1_funding') {
		const listed = h.hop === 1 ? `listed by ${origin}` : `${h.hop - 1} hop${h.hop > 2 ? 's' : ''} from ${origin}`;
		return `Funded by ${h.fromAddress} (${listed}) one hop before THORChain: received ${h.amount ?? 'value'} on ${date} (${h.fromChain} transaction ${h.txid}), then deposited ~$${Math.round(h.usd ?? 0).toLocaleString('en-US')} into THORChain`;
	}
	if (h.action === 'l1_funding2') {
		return `Funded two hops before THORChain from ${origin}: ${h.fromAddress}, itself funded by it, sent ${h.amount ?? 'value'} on ${date} (${h.fromChain} transaction ${h.txid}), then ~$${Math.round(h.usd ?? 0).toLocaleString('en-US')} was deposited into THORChain`;
	}
	const via = viaText(h);
	if (h.relation !== 'value') {
		return `${RELATION_TEXT[h.relation]} ${h.fromAddress}, flagged via ${origin}; ${via} ${h.txid} on ${date}`;
	}
	const amount = h.amount ? `${h.amount}${h.usd ? ` (~$${Math.round(h.usd).toLocaleString('en-US')})` : ''}` : 'value';
	const hopText = h.hop === 1 ? `from ${h.fromAddress}, listed by ${origin}` : `from ${h.fromAddress} (${h.hop - 1} hop${h.hop > 2 ? 's' : ''} from ${origin})`;
	return `Received ${amount} ${hopText} via ${via} ${h.txid} on ${date}`;
}

/** Human-readable reason for a recipient traced by a total of small transfers. */
export function describeSmallTransfers(t: SmallTransferTotal, cfg: TraceConfig = DEFAULT_TRACE_CONFIG): string {
	const origin = t.originEntity ? `${t.originEntity} (${t.originSource})` : t.originSource;
	const who = t.senders.length === 1 ? t.senders[0] : `${t.senders.length} addresses`;
	const hopText = t.hop === 1 ? `from ${who}, listed by ${origin}` : `from ${who} (${t.hop - 1} hop${t.hop > 2 ? 's' : ''} from ${origin})`;
	const first = t.firstDate.slice(0, 10);
	const last = t.lastDate.slice(0, 10);
	const when = first === last ? `on ${first}` : `between ${first} and ${last}`;
	const crossed = t.crossing ? `; the total reached $${cfg.dustUsd} with THORChain ${t.crossing.action} ${t.crossing.txid}` : '';
	return `Received ~$${Math.round(t.usd).toLocaleString('en-US')} in ${t.count} small THORChain transfers (each under $${cfg.dustUsd}) ${hopText}, ${when}${crossed}`;
}
