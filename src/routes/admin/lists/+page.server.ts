import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { ozEntries, manualFlags } from '$lib/server/db/schema';
import { eq, desc, sql, like, and, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(303, '/login');

	const source = url.searchParams.get('source') || '';
	const search = url.searchParams.get('search') || '';
	const page = parseInt(url.searchParams.get('page') || '1');
	const perPage = 50;

	const conditions = [isNull(ozEntries.removedAt)];
	if (source) conditions.push(eq(ozEntries.source, source));
	if (search) conditions.push(like(ozEntries.address, `%${search}%`));

	const entries = await db.select().from(ozEntries)
		.where(and(...conditions))
		.orderBy(desc(ozEntries.lastSeen))
		.limit(perPage)
		.offset((page - 1) * perPage);

	// Counts per source (active entries)
	const sourceCounts = await db
		.select({ source: ozEntries.source, count: sql<number>`count(*)` })
		.from(ozEntries)
		.where(isNull(ozEntries.removedAt))
		.groupBy(ozEntries.source);

	const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(ozEntries).where(isNull(ozEntries.removedAt));

	// Manual flags
	const flags = await db.select().from(manualFlags).orderBy(desc(manualFlags.addedAt));

	return {
		user: locals.user,
		entries: entries.map(e => ({
			id: e.id,
			address: e.address,
			chain: e.chain,
			source: e.source,
			entityName: e.entity,
			reason: e.reason,
			addedAt: e.firstSeen?.toISOString(),
			lastSeen: e.lastSeen?.toISOString(),
		})),
		total: Number(totalResult.count),
		sourceCounts: Object.fromEntries(sourceCounts.map(s => [s.source, Number(s.count)])),
		manualFlags: flags.map(f => ({
			id: f.id,
			address: f.address,
			chain: f.chain,
			reason: f.reason,
			addedBy: f.addedBy,
			addedAt: f.addedAt?.toISOString(),
			active: f.active,
		})),
		page,
		perPage,
		source,
		search,
	};
};
