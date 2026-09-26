/**
 * Ozone's verdict model. A verdict for one address is the list of reasons
 * (each with its source, provenance and risk) plus the resulting status
 * under a policy. The default policy flags at risk `high` or above.
 */

export const RISKS = ['none', 'info', 'low', 'medium', 'high', 'severe'] as const;
export type Risk = (typeof RISKS)[number];

export function riskRank(r: Risk): number {
	const i = RISKS.indexOf(r);
	return i < 0 ? 0 : i;
}

export function riskFromRank(n: number): Risk {
	return RISKS[Math.max(0, Math.min(RISKS.length - 1, Math.round(n)))];
}

export function maxRisk(risks: Iterable<Risk>): Risk {
	let best = 0;
	for (const r of risks) best = Math.max(best, riskRank(r));
	return RISKS[best];
}

export function isRisk(value: unknown): value is Risk {
	return typeof value === 'string' && (RISKS as readonly string[]).includes(value);
}

/** Why an address is on Ozone's radar. */
export type Category =
	| 'sanctions' // official sanctions list (OFAC, UK, EU, oracle mirror)
	| 'law_enforcement' // attribution published by a law-enforcement agency (FBI, DOJ)
	| 'hack' // funds from a known hack / exploit, attributed cluster
	| 'exploit' // labelled exploiter / attacker address
	| 'stablecoin_freeze' // frozen by the stablecoin issuer (Tether, Circle)
	| 'phishing' // phishing / drainer lists
	| 'scam'
	| 'manual' // added by an Ozone maintainer with a written reason
	| 'traced' // received value from a listed address through THORChain
	| 'key_twin'; // same private key as a listed address on a sibling chain

export interface TraceInfo {
	/** 1 = received directly from a listed address; 2 = from a hop-1 address; … */
	hop: number;
	/** THORChain action type (swap, send, withdraw, addLiquidity, …). */
	action: string;
	/** Inbound transaction id of the THORChain action. */
	txid: string;
	height?: number;
	/** ISO date of the action. */
	date?: string;
	/** Address the value came from (on its own chain). */
	from: string;
	fromChain?: string;
	/** What arrived, e.g. `1.21327264 BTC.BTC`. */
	amount?: string;
	/** Approximate USD value at the time (0 when unknown). */
	usd?: number;
	/** The listed address the flow originates from. */
	originKey: string;
	originSource: string;
	originEntity?: string;
}

export interface Reason {
	/** Stable machine code, e.g. OFAC_SDN, TETHER_FROZEN, TRACE_SWAP. */
	code: string;
	/** Source id (see `sources` in the snapshot). */
	source: string;
	category: Category;
	risk: Risk;
	/** Human-readable explanation. */
	text: string;
	entity?: string;
	/** Chain the source listed the address under. */
	chain?: string;
	/** Address as matched (canonical). */
	address?: string;
	/** Provenance URL (list entry, press release, freeze transaction, …). */
	ref?: string;
	/** Source-specific id (OFAC uid, UK unique id, event tx hash, …). */
	refId?: string;
	/** When the source listed it (ISO), if the source says so. */
	listedAt?: string;
	/** When Ozone first saw it on the source (ISO). */
	firstSeen?: string;
	/** Delisted / unfrozen (ISO). A removed reason never flags. */
	removedAt?: string;
	/** Present on traced reasons. */
	trace?: TraceInfo;
}

export type VerdictStatus = 'clean' | 'flagged' | 'invalid';

export interface SnapshotRef {
	version: number;
	builtAt: string;
	sha256: string;
	/** Seconds between the snapshot build and the verdict. */
	ageSeconds: number;
	/** Older than the client's freshness threshold. */
	stale: boolean;
}

export interface Verdict {
	/** Address exactly as submitted. */
	input: string;
	/** Chain hint as submitted (normalized), if any. */
	chain?: string;
	/** Canonical keys that were checked. */
	keys: string[];
	valid: boolean;
	status: VerdictStatus;
	/** Highest risk among the active reasons (`none` when clean). */
	risk: Risk;
	/** Active reasons first (highest risk first), then historical ones. */
	reasons: Reason[];
	/** Short evidence string for logs/attestations (≤ 128 printable chars). */
	reference?: string;
	snapshot?: SnapshotRef;
}

export interface Policy {
	/** Minimum active risk that makes the verdict `flagged`. Default `high`. */
	flagAt?: Risk;
	/** Ignore traced reasons deeper than this hop. Default: no limit beyond the snapshot's own. */
	maxTraceHop?: number;
	/** Reason categories to ignore entirely (e.g. `['phishing']`). */
	ignoreCategories?: Category[];
}

export const DEFAULT_FLAG_AT: Risk = 'high';

export function isActive(r: Reason): boolean {
	return !r.removedAt;
}

/** Applies the policy to a set of reasons and returns status/risk/sorted reasons. */
export function evaluate(
	reasons: Reason[],
	policy: Policy = {}
): { status: 'clean' | 'flagged'; risk: Risk; reasons: Reason[] } {
	const flagAt = riskRank(policy.flagAt ?? DEFAULT_FLAG_AT);
	const ignore = new Set(policy.ignoreCategories ?? []);
	const kept = reasons.filter(
		(r) =>
			!ignore.has(r.category) &&
			!(policy.maxTraceHop !== undefined && r.trace && r.trace.hop > policy.maxTraceHop)
	);
	const active = kept.filter(isActive);
	const risk = active.length ? maxRisk(active.map((r) => r.risk)) : 'none';
	const sorted = [...kept].sort((a, b) => {
		const aa = isActive(a) ? 1 : 0;
		const bb = isActive(b) ? 1 : 0;
		if (aa !== bb) return bb - aa;
		const d = riskRank(b.risk) - riskRank(a.risk);
		if (d) return d;
		const ha = a.trace?.hop ?? 0;
		const hb = b.trace?.hop ?? 0;
		if (ha !== hb) return ha - hb;
		return a.code.localeCompare(b.code);
	});
	return { status: riskRank(risk) >= flagAt && active.length ? 'flagged' : 'clean', risk, reasons: sorted };
}

/** `oz:v<version>:<codes>` — compact evidence for a flagged verdict. */
export function referenceFor(version: number | undefined, reasons: Reason[], status: VerdictStatus): string {
	const active = reasons.filter(isActive);
	const codes = [...new Set(active.map((r) => r.code))].sort().join(',');
	const base = `oz:v${version ?? 0}:${status}`;
	const ref = codes ? `${base}:${codes}` : base;
	return ref.length <= 128 ? ref : ref.slice(0, 128);
}
