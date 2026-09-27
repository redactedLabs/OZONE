/**
 * Chainabuse (TRM Labs) community scam reports — an optional source that
 * needs a (free) account key: CHAINABUSE_API_KEY. Without the key the
 * source is not scheduled at all (registry.ts activeSources).
 *
 * - Only reports Chainabuse moderators have verified (`checked=true`).
 * - Risk `medium`: community reports are published and traced, but do not
 *   flag at the default policy (flagAt `high`) on their own.
 * - The free tier allows 10 API calls a month (50 reports each), so a sync
 *   is incremental: it reads the newest reports since the last one it
 *   stored (at most CHAINABUSE_MAX_PAGES pages, default 2) and keeps every
 *   report stored before — each sync still hands the store a complete
 *   picture, so nothing is delisted because this run did not re-read it.
 *
 * API: GET https://api.chainabuse.com/v0/reports (HTTP basic auth, the key as
 * user name), documented at https://chainabuse.readme.io/reference/reports-1.
 * Review Chainabuse's terms for storing and republishing report data before
 * enabling it; the key is only ever sent to api.chainabuse.com.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import type { Category } from '../../../ozone-client/src/index.js';
import { emptyResult, type ListEntry, type ParseResult, type Sql } from '../types.js';
import { httpJson, type HttpOptions } from '../util/http.js';

export const CHAINABUSE_API = 'https://api.chainabuse.com/v0/reports';
export const CHAINABUSE_SOURCE_ID = 'chainabuse';

/** Chainabuse ChainKind → Ozone chain code (chains Ozone screens). */
const CHAINS: Record<string, string> = {
	BTC: 'BTC',
	ETH: 'ETH',
	TRON: 'TRON',
	SOL: 'SOL',
	POLYGON: 'POL',
	BINANCE: 'BSC',
	LITECOIN: 'LTC',
	AVALANCHE: 'AVAX',
	ARBITRUM: 'ARB',
	BASE: 'BASE'
};

export interface ChainabuseReport {
	id: string;
	checked?: boolean;
	trusted?: boolean;
	scamCategory?: string | null;
	createdAt?: string;
	addresses?: Array<{ address?: string | null; chain?: string | null; domain?: string | null }>;
}

function categoryOf(scamCategory: string | null | undefined): Category {
	return (scamCategory ?? '').toUpperCase() === 'PHISHING' ? 'phishing' : 'scam';
}

/** Verified reports → entries (unsupported chains and invalid addresses are skipped, not guessed). */
export function parseChainabuseReports(reports: ChainabuseReport[]): ParseResult {
	const res = emptyResult();
	const byKey = new Map<string, ListEntry>();
	for (const r of reports) {
		if (r.checked !== true) continue;
		const kind = (r.scamCategory ?? 'OTHER').toUpperCase();
		for (const a of r.addresses ?? []) {
			if (!a.address || !a.chain) continue;
			const chain = CHAINS[a.chain.toUpperCase()];
			if (!chain) continue;
			const p = parseForChain(a.address.trim(), chain);
			if (!p) {
				res.rejected.push({ raw: a.address, declared: a.chain, context: `chainabuse report ${r.id}` });
				continue;
			}
			if (byKey.has(p.key)) continue;
			byKey.set(p.key, {
				source: CHAINABUSE_SOURCE_ID,
				key: p.key,
				chain: p.chain,
				address: p.address,
				category: categoryOf(r.scamCategory),
				risk: 'medium',
				code: 'CHAINABUSE_REPORT',
				entity: `Chainabuse report (${kind.toLowerCase().replace(/_/g, ' ')})`,
				text: `Reported on Chainabuse as ${kind.toLowerCase().replace(/_/g, ' ')}; the report was verified by Chainabuse moderators${r.trusted ? ' (trusted contributor)' : ''}`,
				refUrl: `https://www.chainabuse.com/report/${encodeURIComponent(r.id)}`,
				refId: `chainabuse:${r.id}`,
				...(r.createdAt ? { listedAt: new Date(r.createdAt).toISOString() } : {}),
				meta: { scamCategory: kind, trusted: !!r.trusted }
			});
		}
	}
	res.entries = [...byKey.values()];
	return res;
}

/** Entries stored by earlier syncs (kept: this source is read incrementally). */
async function storedEntries(sql: Sql): Promise<{ entries: ListEntry[]; newest?: string }> {
	const r = await sql.query<{
		key: string;
		chain: string;
		address: string;
		category: Category;
		risk: ListEntry['risk'];
		code: string;
		entity: string | null;
		reason: string;
		ref_url: string | null;
		ref_id: string | null;
		listed_at: string | Date | null;
		meta: Record<string, unknown> | null;
	}>(
		`SELECT key, chain, address, category, risk, code, entity, reason, ref_url, ref_id, listed_at, meta
		 FROM oz_entries WHERE source = $1 AND removed_at IS NULL`,
		[CHAINABUSE_SOURCE_ID]
	);
	let newest: string | undefined;
	const entries = r.rows.map((x) => {
		const listedAt = x.listed_at ? new Date(x.listed_at).toISOString() : undefined;
		if (listedAt && (!newest || listedAt > newest)) newest = listedAt;
		return {
			source: CHAINABUSE_SOURCE_ID,
			key: x.key,
			chain: x.chain,
			address: x.address,
			category: x.category,
			risk: x.risk,
			code: x.code,
			...(x.entity ? { entity: x.entity } : {}),
			text: x.reason,
			...(x.ref_url ? { refUrl: x.ref_url } : {}),
			...(x.ref_id ? { refId: x.ref_id } : {}),
			...(listedAt ? { listedAt } : {}),
			...(x.meta ? { meta: x.meta } : {})
		} satisfies ListEntry;
	});
	return { entries, newest };
}

export async function syncChainabuse(
	opts: HttpOptions & { sql?: Sql; apiKey?: string; maxPages?: number; now?: Date } = {}
): Promise<ParseResult> {
	const key = opts.apiKey ?? process.env.CHAINABUSE_API_KEY;
	if (!key) throw new Error('CHAINABUSE_API_KEY is not set (source disabled)');
	if (!opts.sql) throw new Error('chainabuse source needs the database (it is read incrementally)');
	const stored = await storedEntries(opts.sql);
	// re-read a week before the newest stored report: late moderation, clock skew
	const since = stored.newest ? new Date(Date.parse(stored.newest) - 7 * 24 * 3600_000).toISOString() : undefined;
	const maxPages = Math.max(1, opts.maxPages ?? (Number(process.env.CHAINABUSE_MAX_PAGES) || 2));
	const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
	const reports: ChainabuseReport[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const q = new URLSearchParams({ checked: 'true', perPage: '50', page: String(page), orderByField: 'CREATED_AT', ...(since ? { since } : {}) });
		const body = await httpJson<{ reports?: ChainabuseReport[] }>(`${CHAINABUSE_API}?${q.toString()}`, {
			timeoutMs: 60_000,
			retries: 1,
			...opts,
			headers: { authorization: auth }
		});
		const list = Array.isArray(body.reports) ? body.reports : [];
		reports.push(...list);
		if (list.length < 50) break;
	}
	const fresh = parseChainabuseReports(reports);
	const byKey = new Map(stored.entries.map((e) => [e.key, e]));
	for (const e of fresh.entries) if (!byKey.has(e.key)) byKey.set(e.key, e);
	const res = emptyResult();
	res.entries = [...byKey.values()];
	res.rejected = fresh.rejected;
	res.version = `reports:${reports.length}${since ? ` since ${since.slice(0, 10)}` : ''}`;
	return res;
}
