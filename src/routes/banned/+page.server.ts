import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/ozone/sql';
import { SOURCES, DERIVED_SOURCES } from '$engine/index.js';

const NAMES: Record<string, string> = Object.fromEntries([...SOURCES, ...DERIVED_SOURCES].map((s) => [s.id, s.name]));

export const load: PageServerLoad = async ({ url }) => {
	const source = url.searchParams.get('source') || '';
	const search = (url.searchParams.get('search') || '').trim();
	const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1);
	const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
	const history = url.searchParams.get('history') === '1';
	const perPage = 50;

	const where: string[] = [history ? 'removed_at IS NOT NULL' : 'removed_at IS NULL'];
	const params: unknown[] = [];
	if (source) {
		params.push(source);
		where.push(`source = $${params.length}`);
	}
	if (search) {
		params.push(`%${search.toLowerCase()}%`);
		where.push(`(lower(address) LIKE $${params.length} OR lower(coalesce(entity,'')) LIKE $${params.length})`);
	}
	const w = where.join(' AND ');
	const order = sort === 'oldest' ? 'coalesce(listed_at, first_seen) ASC' : 'coalesce(listed_at, first_seen) DESC';
	const entries = await sql.query<{
		source: string;
		address: string;
		chain: string;
		category: string;
		risk: string;
		entity: string | null;
		reason: string;
		ref_url: string | null;
		listed_at: string | null;
		first_seen: string;
		removed_at: string | null;
	}>(
		`SELECT source, address, chain, category, risk, entity, reason, ref_url, listed_at, first_seen, removed_at
		 FROM oz_entries WHERE ${w} ORDER BY ${order}, id LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
		params
	);
	const [filtered] = (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_entries WHERE ${w}`, params)).rows;
	const counts = await sql.query<{ source: string; n: number }>(
		`SELECT source, count(*)::int AS n FROM oz_entries WHERE ${history ? 'removed_at IS NOT NULL' : 'removed_at IS NULL'} GROUP BY source ORDER BY n DESC`
	);
	const [distinct] = (await sql.query<{ n: number }>(`SELECT count(DISTINCT key)::int AS n FROM oz_entries WHERE removed_at IS NULL`)).rows;

	return {
		entries: entries.rows.map((e) => ({
			source: e.source,
			sourceName: NAMES[e.source] ?? e.source,
			address: e.address,
			chain: e.chain,
			category: e.category,
			risk: e.risk,
			entityName: e.entity,
			reason: e.reason,
			ref: e.ref_url,
			listedAt: e.listed_at ? new Date(e.listed_at).toISOString() : null,
			addedAt: new Date(e.first_seen).toISOString(),
			removedAt: e.removed_at ? new Date(e.removed_at).toISOString() : null
		})),
		total: filtered?.n ?? 0,
		totalAll: distinct?.n ?? 0,
		sourceCounts: Object.fromEntries(counts.rows.map((c) => [c.source, c.n])),
		sourceNames: NAMES,
		page,
		perPage,
		source,
		search,
		sort,
		history
	};
};
