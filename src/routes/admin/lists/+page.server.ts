import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { complianceEntries, manualFlags } from '$lib/server/db/schema';
import { eq, desc, sql, like } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(303, '/login');

	const source = url.searchParams.get('source') || '';
	const search = url.searchParams.get('search') || '';
	const page = parseInt(url.searchParams.get('page') || '1');
	const perPage = 50;

	let conditions: any[] = [];
	if (source) conditions.push(eq(complianceEntries.source, source));
	if (search) conditions.push(like(complianceEntries.address, `%${search}%`));

	const entries = conditions.length > 0
		? await db.select().from(complianceEntries)
			.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions[1]}`)
			.orderBy(desc(complianceEntries.lastSeen))
			.limit(perPage)
			.offset((page - 1) * perPage)
		: await db.select().from(complianceEntries)
			.orderBy(desc(complianceEntries.lastSeen))
			.limit(perPage)
			.offset((page - 1) * perPage);

	// Counts per source
	const sourceCounts = await db
		.select({ source: complianceEntries.source, count: sql<number>`count(*)` })
		.from(complianceEntries)
		.groupBy(complianceEntries.source);

	const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(complianceEntries);

	// Manual flags
	const flags = await db.select().from(manualFlags).orderBy(desc(manualFlags.addedAt));

	return {
		user: locals.user,
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
