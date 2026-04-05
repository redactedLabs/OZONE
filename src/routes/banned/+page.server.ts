import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { complianceEntries } from '$lib/server/db/schema';
import { eq, desc, asc, sql, like } from 'drizzle-orm';

export const load: PageServerLoad = async ({ url }) => {
	const source = url.searchParams.get('source') || '';
	const search = url.searchParams.get('search') || '';
	const page = parseInt(url.searchParams.get('page') || '1');
	const sort = url.searchParams.get('sort') || 'newest';
	const perPage = 50;

	let conditions: any[] = [];
	if (source) conditions.push(eq(complianceEntries.source, source));
	if (search) conditions.push(like(complianceEntries.address, `%${search}%`));

	const orderBy = sort === 'oldest' ? asc(complianceEntries.addedAt) : desc(complianceEntries.addedAt);

	const entries = conditions.length > 0
		? await db.select().from(complianceEntries)
			.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions[1]}`)
			.orderBy(orderBy)
			.limit(perPage)
			.offset((page - 1) * perPage)
		: await db.select().from(complianceEntries)
			.orderBy(orderBy)
			.limit(perPage)
			.offset((page - 1) * perPage);

	const sourceCounts = await db
		.select({ source: complianceEntries.source, count: sql<number>`count(*)` })
		.from(complianceEntries)
		.groupBy(complianceEntries.source);

	const [totalAll] = await db.select({ count: sql<number>`count(*)` }).from(complianceEntries);

	// Filtered total for pagination
	const [filteredTotal] = conditions.length > 0
		? await db.select({ count: sql<number>`count(*)` }).from(complianceEntries)
			.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions[1]}`)
		: [{ count: Number(totalAll.count) }];

	return {
		entries: entries.map(e => ({
			id: e.id,
			address: e.address,
			chain: e.chain,
			source: e.source,
			entityName: e.entityName,
			reason: e.reason,
			addedAt: e.addedAt?.toISOString(),
			lastSeen: e.lastSeen?.toISOString(),
		})),
		total: Number(filteredTotal.count),
		totalAll: Number(totalAll.count),
		sourceCounts: Object.fromEntries(sourceCounts.map(s => [s.source, Number(s.count)])),
		page,
		perPage,
		source,
		search,
		sort,
	};
};
