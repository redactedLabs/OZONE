/**
 * The two public "flagged" numbers and their lists, computed from the
 * signed snapshot only — the same data every node downloads, so nothing
 * private (monitored accounts, request data, maintainer notes) can leak:
 *
 * 1. **flagged addresses**: every key in the snapshot whose active reasons
 *    reach the default policy (risk `high` or above), across all chains —
 *    listed, traced, linked and same-key twins alike, each key counted once;
 * 2. **flagged THORChain addresses**: the `thor:` keys among them.
 *
 * A row carries only what the snapshot already publishes: address, chain,
 * risk, reason codes, sources and the incident (or listed entity) behind it.
 */
import { DEFAULT_FLAG_AT, evaluate, isActive, riskRank, type Reason, type Risk, type SnapshotIndex } from '$ozone/index.js';

export type FlaggedKind = 'listed' | 'traced' | 'linked' | 'twin';

export interface FlaggedRow {
	address: string;
	/** Chain family of the key: `EVM` (one key for every EVM chain), `BTC`, `THOR`, … */
	chain: string;
	risk: Risk;
	/** How the key is flagged: its strongest kind of flagging reason. */
	kind: FlaggedKind;
	/** Codes of the active reasons that flag it (risk ≥ high). */
	codes: string[];
	/** Sources of those reasons. */
	sources: string[];
	/** The incident or listed entity behind it (hack, attribution, maintainer incident, or a traced origin's), if the snapshot names one. */
	incident: string | null;
}

export interface FlaggedSummary {
	snapshot: { version: number; builtAt: string; sha256: string };
	counts: {
		/** (1) Every flagged key, all chains. */
		flaggedAddresses: number;
		/** (2) The `thor:` keys among them. */
		flaggedThorAddresses: number;
	};
	byKind: Record<FlaggedKind, number>;
	thorByKind: Record<FlaggedKind, number>;
	/** Flagged keys per source (a key flagged by two sources counts once in each). */
	bySource: Array<{ source: string; keys: number }>;
	/** The same for the thor1 keys. */
	thorBySource: Array<{ source: string; keys: number }>;
	/** Flagged keys per chain family (each key once). */
	byChain: Array<{ chain: string; keys: number }>;
	rows: FlaggedRow[];
}

const DERIVED: Record<string, FlaggedKind> = { thorchain_trace: 'traced', thorchain_links: 'linked', key_twin: 'twin' };
const KIND_ORDER: FlaggedKind[] = ['listed', 'traced', 'linked', 'twin'];
/** Categories whose entity names an incident or an attributed actor. */
const INCIDENT_CATEGORIES = new Set(['hack', 'exploit', 'law_enforcement', 'manual', 'sanctions']);

const NAMESPACE_CHAIN: Record<string, string> = { evm: 'EVM' };

export function chainOfKey(key: string): string {
	const ns = key.slice(0, key.indexOf(':'));
	return NAMESPACE_CHAIN[ns] ?? ns.toUpperCase();
}

function kindOf(source: string): FlaggedKind {
	return DERIVED[source] ?? 'listed';
}

function incidentOf(reasons: Reason[]): string | null {
	for (const r of reasons) {
		if (r.trace?.originEntity) return r.trace.originEntity;
		if (r.entity && INCIDENT_CATEGORIES.has(r.category)) return r.entity;
	}
	for (const r of reasons) if (r.entity) return r.entity;
	return null;
}

const emptyKinds = (): Record<FlaggedKind, number> => ({ listed: 0, traced: 0, linked: 0, twin: 0 });

/** Computes both counters and the rows behind them (pure; see `flaggedSummary` for the cached form). */
export function summarizeFlagged(index: SnapshotIndex, flagAt: Risk = DEFAULT_FLAG_AT): FlaggedSummary {
	const threshold = riskRank(flagAt);
	const rows: FlaggedRow[] = [];
	const byKind = emptyKinds();
	const thorByKind = emptyKinds();
	const bySource = new Map<string, number>();
	const thorBySource = new Map<string, number>();
	const byChain = new Map<string, number>();
	let thor = 0;
	for (const key of index.keys()) {
		const reasons = index.reasonsForKey(key);
		const verdict = evaluate(reasons, { flagAt });
		if (verdict.status !== 'flagged') continue;
		// the reasons that flag it: active, at or above the threshold (strongest first)
		const flagging = verdict.reasons.filter((r) => isActive(r) && riskRank(r.risk) >= threshold);
		const kinds = new Set(flagging.map((r) => kindOf(r.source)));
		const kind = KIND_ORDER.find((k) => kinds.has(k)) ?? 'listed';
		const sources = [...new Set(flagging.map((r) => r.source))];
		const chain = chainOfKey(key);
		rows.push({
			address: key.slice(key.indexOf(':') + 1),
			chain,
			risk: verdict.risk,
			kind,
			codes: [...new Set(flagging.map((r) => r.code))],
			sources,
			incident: incidentOf(flagging)
		});
		byKind[kind]++;
		for (const s of sources) bySource.set(s, (bySource.get(s) ?? 0) + 1);
		byChain.set(chain, (byChain.get(chain) ?? 0) + 1);
		if (key.startsWith('thor:')) {
			thor++;
			thorByKind[kind]++;
			for (const s of sources) thorBySource.set(s, (thorBySource.get(s) ?? 0) + 1);
		}
	}
	rows.sort(
		(a, b) =>
			riskRank(b.risk) - riskRank(a.risk) ||
			KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
			(a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0) ||
			(a.address < b.address ? -1 : a.address > b.address ? 1 : 0)
	);
	const desc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
	return {
		snapshot: { version: index.version, builtAt: index.builtAt, sha256: index.sha256 },
		counts: { flaggedAddresses: rows.length, flaggedThorAddresses: thor },
		byKind,
		thorByKind,
		bySource: desc(bySource).map(([source, keys]) => ({ source, keys })),
		thorBySource: desc(thorBySource).map(([source, keys]) => ({ source, keys })),
		byChain: desc(byChain).map(([chain, keys]) => ({ chain, keys })),
		rows
	};
}

let cached: { id: string; summary: FlaggedSummary } | undefined;

/** `summarizeFlagged` computed once per snapshot version. */
export function flaggedSummary(index: SnapshotIndex): FlaggedSummary {
	const id = `${index.version}:${index.sha256}`;
	if (cached?.id !== id) cached = { id, summary: summarizeFlagged(index) };
	return cached.summary;
}

export type FlaggedListName = 'all' | 'thor';

export interface FlaggedQuery {
	list: FlaggedListName;
	/** Case-insensitive substring of the address or the incident. */
	q?: string;
	source?: string;
	chain?: string;
	offset?: number;
	limit?: number;
}

/** Every row of a list that matches the filters (offset/limit ignored). */
export function flaggedMatches(summary: FlaggedSummary, query: Omit<FlaggedQuery, 'offset' | 'limit'>): FlaggedRow[] {
	const q = query.q?.trim().toLowerCase();
	const chain = query.chain?.trim().toUpperCase();
	return summary.rows.filter(
		(r) =>
			(query.list !== 'thor' || r.chain === 'THOR') &&
			(!query.source || r.sources.includes(query.source)) &&
			(!chain || r.chain === chain) &&
			(!q || r.address.toLowerCase().includes(q) || (r.incident ?? '').toLowerCase().includes(q))
	);
}

/** One page of a list (at most 1,000 rows) and how many rows match. */
export function flaggedPage(summary: FlaggedSummary, query: FlaggedQuery): { total: number; rows: FlaggedRow[] } {
	const matches = flaggedMatches(summary, query);
	const offset = Math.max(0, Math.floor(query.offset ?? 0));
	const limit = Math.max(1, Math.min(1000, Math.floor(query.limit ?? 100)));
	return { total: matches.length, rows: matches.slice(offset, offset + limit) };
}

export function parseListName(value: string | null | undefined): FlaggedListName | undefined {
	return value === 'all' || value === 'thor' ? value : undefined;
}

/** CSV of a whole list (address, chain, risk, kind, codes, sources, incident). */
export function flaggedCsv(rows: FlaggedRow[]): string {
	const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
	const lines = ['address,chain,risk,kind,codes,sources,incident'];
	for (const r of rows) lines.push([q(r.address), r.chain, r.risk, r.kind, q(r.codes.join(' ')), q(r.sources.join(' ')), q(r.incident ?? '')].join(','));
	return lines.join('\n');
}

/** Where each list is served (JSON; add `&format=csv` for a download). */
export const LISTS = {
	flaggedAddresses: '/api/flagged?list=all',
	flaggedThorAddresses: '/api/flagged?list=thor',
	monitoredThorAccountsFlagged: '/api/flagged?list=users'
};

/** One meaning per number (also on /methodology). */
export const DEFINITIONS = {
	flaggedAddresses:
		'Every address in the newest signed snapshot whose active reasons reach risk "high" or above, on any chain: listed, traced through THORChain, linked, or controlled by the same key as a listing. Each address (key) counts once.',
	flaggedThorAddresses: 'The THORChain (thor1) addresses among the flagged addresses.',
	monitoredThorAccountsFlagged:
		'Monitored thor1 accounts (Rujira League, LPs, live transactions) that are flagged themselves or linked by their own signed actions to a listed L1 address. Formerly "Flagged THORChain Users".'
};

/** The counters and breakdown as published in /api/flagged's meta. */
export function summaryMeta(summary: FlaggedSummary) {
	return {
		counts: summary.counts,
		breakdown: {
			byKind: summary.byKind,
			thorByKind: summary.thorByKind,
			bySource: summary.bySource,
			thorBySource: summary.thorBySource,
			byChain: summary.byChain
		}
	};
}
