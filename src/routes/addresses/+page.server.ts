import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { rujiraUsers, l1Addresses } from '$lib/server/db/schema';
import { eq, and, desc, sql, inArray, like } from 'drizzle-orm';

const MIDGARD_URL = 'https://gateway.liquify.com/chain/thorchain_midgard';

function chainFromAsset(asset: string): string {
	if (!asset) return 'UNKNOWN';
	if (asset.includes('.')) return asset.split('.')[0] || 'UNKNOWN';
	if (asset.includes('~')) return asset.split('~')[0] || 'UNKNOWN';
	if (asset.includes('/')) return asset.split('/')[0] || 'UNKNOWN';
	return asset.split('-')[0] || 'UNKNOWN';
}

function chainFromAddress(address: string): string | null {
	if (!address) return null;
	if (address.startsWith('thor')) return 'THOR';
	if (address.startsWith('cosmos')) return 'GAIA';
	if (address.startsWith('bc1') || /^[13][a-km-zA-HJ-NP-Z1-9]{25,}$/.test(address)) return 'BTC';
	if (address.startsWith('ltc1') || /^[LM][a-km-zA-HJ-NP-Z1-9]{25,}$/.test(address)) return 'LTC';
	if (address.startsWith('bnb')) return 'BNB';
	return null;
}

async function lookupAndImport(address: string) {
	try {
		// Insert user
		await db.insert(rujiraUsers).values({ thorAddress: address }).onConflictDoNothing();

		// 1. Scan ALL actions with pagination for L1 addresses
		const pageSize = 50;
		const maxPages = 100;
		let nextPageToken: string | null = null;
		let hasActions = false;

		for (let page = 0; page < maxPages; page++) {
			let url = `${MIDGARD_URL}/v2/actions?address=${address}&limit=${pageSize}`;
			if (nextPageToken) {
				url += `&nextPageToken=${nextPageToken}`;
			} else if (page > 0) {
				break;
			}

			const res = await fetch(url);
			if (!res.ok) break;
			const data = await res.json();
			const actions = data?.actions || [];
			if (actions.length === 0) break;
			hasActions = true;

			for (const action of actions) {
				for (const io of [...(action.in || []), ...(action.out || [])]) {
					if (io.address && !io.address.startsWith('thor') && io.address !== address) {
						const asset = io.coins?.[0]?.asset || '';
						const chain = chainFromAddress(io.address) || chainFromAsset(asset);
						if (chain !== 'UNKNOWN') {
							await db.insert(l1Addresses).values({
								thorAddress: address,
								l1Address: io.address,
								chain,
								pool: asset,
							}).onConflictDoNothing();
						}
					}
				}
			}

			nextPageToken = data?.meta?.nextPageToken || null;
			if (!nextPageToken || actions.length < pageSize) break;
			await new Promise(r => setTimeout(r, 150));
		}

		if (!hasActions) return null;

		// 2. Also check LP membership
		try {
			const memberRes = await fetch(`${MIDGARD_URL}/v2/member/${address}`);
			if (memberRes.ok) {
				const memberData = await memberRes.json();
				for (const pool of memberData?.pools || []) {
					if (pool.assetAddress) {
						const chain = chainFromAddress(pool.assetAddress) || chainFromAsset(pool.pool);
						await db.insert(l1Addresses).values({
							thorAddress: address,
							l1Address: pool.assetAddress,
							chain,
							pool: pool.pool,
						}).onConflictDoNothing();
					}
				}
			}
		} catch { /* not an LP */ }

		// Mark as fetched
		await db.update(rujiraUsers)
			.set({ l1FetchedAt: new Date() })
			.where(eq(rujiraUsers.thorAddress, address));

		return true;
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async ({ url }) => {
	const filter = url.searchParams.get('filter') || 'linked';
	const chain = url.searchParams.get('chain') || '';
	const search = url.searchParams.get('search') || '';
	const page = parseInt(url.searchParams.get('page') || '1');
	const perPage = 50;

	// If searching for a specific address not in our DB, try Midgard lookup
	if (search && search.startsWith('thor')) {
		const existing = await db.select().from(rujiraUsers)
			.where(eq(rujiraUsers.thorAddress, search)).limit(1);

		if (existing.length === 0) {
			await lookupAndImport(search);
		}
	}

	let users: any[];

	if (search) {
		// Server-side search
		let conditions: any[] = [like(rujiraUsers.thorAddress, `%${search}%`)];
		if (filter === 'flagged') conditions.push(eq(rujiraUsers.flagged, true));
		else if (filter === 'clean') conditions.push(eq(rujiraUsers.flagged, false));

		users = await db.select().from(rujiraUsers)
			.where(and(...conditions))
			.orderBy(desc(rujiraUsers.lastSeen))
			.limit(perPage)
			.offset((page - 1) * perPage);

		// Also search L1 addresses if no thor results
		if (users.length === 0) {
			const l1Match = await db.select().from(l1Addresses)
				.where(like(l1Addresses.l1Address, `%${search}%`))
				.limit(perPage);

			if (l1Match.length > 0) {
				const thorAddrs = [...new Set(l1Match.map(l => l.thorAddress))];
				users = await db.select().from(rujiraUsers)
					.where(inArray(rujiraUsers.thorAddress, thorAddrs))
					.orderBy(desc(rujiraUsers.lastSeen))
					.limit(perPage);
			}
		}
	} else if (chain) {
		const thorAddrsWithChain = await db
			.selectDistinct({ thorAddress: l1Addresses.thorAddress })
			.from(l1Addresses)
			.where(eq(l1Addresses.chain, chain));

		const thorAddrs = thorAddrsWithChain.map(r => r.thorAddress);
		if (thorAddrs.length === 0) {
			return { users: [], total: 0, totalL1: 0, page, perPage, filter, chain, search };
		}

		let conditions: any[] = [inArray(rujiraUsers.thorAddress, thorAddrs)];
		if (filter === 'flagged') conditions.push(eq(rujiraUsers.flagged, true));
		else if (filter === 'clean') conditions.push(eq(rujiraUsers.flagged, false));

		users = await db.select().from(rujiraUsers)
			.where(and(...conditions))
			.orderBy(desc(rujiraUsers.lastSeen))
			.limit(perPage)
			.offset((page - 1) * perPage);
	} else if (filter === 'linked') {
		// Only show users that have at least one L1 address
		const linkedThorAddrs = await db
			.selectDistinct({ thorAddress: l1Addresses.thorAddress })
			.from(l1Addresses)
			.limit(5000);

		const thorAddrs = linkedThorAddrs.map(r => r.thorAddress);
		if (thorAddrs.length === 0) {
			users = [];
		} else {
			users = await db.select().from(rujiraUsers)
				.where(inArray(rujiraUsers.thorAddress, thorAddrs))
				.orderBy(desc(rujiraUsers.lastSeen))
				.limit(perPage)
				.offset((page - 1) * perPage);
		}
	} else if (filter === 'flagged') {
		users = await db.select().from(rujiraUsers)
			.where(eq(rujiraUsers.flagged, true))
			.orderBy(desc(rujiraUsers.lastSeen))
			.limit(perPage)
			.offset((page - 1) * perPage);
	} else {
		users = await db.select().from(rujiraUsers)
			.orderBy(desc(rujiraUsers.lastSeen))
			.limit(perPage)
			.offset((page - 1) * perPage);
	}

	const usersWithL1 = await Promise.all(
		users.map(async (user) => {
			const l1s = await db.select().from(l1Addresses)
				.where(eq(l1Addresses.thorAddress, user.thorAddress));

			// Deduplicate by address+chain
			const seen = new Set<string>();
			const uniqueL1s = l1s.filter((l) => {
				const key = `${l.l1Address}:${l.chain}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});

			return {
				...user,
				firstSeen: user.firstSeen?.toISOString() || null,
				lastSeen: user.lastSeen?.toISOString() || null,
				screenedAt: user.screenedAt?.toISOString() || null,
				l1Addresses: uniqueL1s.map((l) => ({
					address: l.l1Address,
					chain: l.chain,
					pool: l.pool
				}))
			};
		})
	);

	const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(rujiraUsers);
	const [l1Total] = await db.select({ count: sql<number>`count(DISTINCT l1_address || ':' || chain)` }).from(l1Addresses);

	return {
		users: usersWithL1,
		total: Number(totalResult.count),
		totalL1: Number(l1Total.count),
		page, perPage, filter, chain, search
	};
};
