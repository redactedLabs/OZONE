import { db } from '../db';
import { rujiraUsers, l1Addresses, syncLog } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import pLimit from 'p-limit';
import { bech32 } from 'bech32';

const MIDGARD_URL = () => env.MIDGARD_URL || 'https://gateway.liquify.com/chain/thorchain_midgard';
const RUJIRA_GQL = 'https://api.rujira.network/api/graphiql';

/**
 * Convert a Cosmos SDK bech32 address (cosmos1, osmo1, etc.) to thor1.
 * Same key bytes, different prefix. Returns null for non-Cosmos chains.
 * IMPORTANT: Only Cosmos SDK chains share key derivation with THORChain.
 * Bitcoin (bc1), Litecoin (ltc1) etc. also use bech32 but have DIFFERENT keys.
 */
const COSMOS_SDK_PREFIXES = new Set([
	'cosmos', 'osmo', 'kujira', 'terra', 'akash', 'juno', 'stars',
	'inj', 'sei', 'evmos', 'cro', 'axelar', 'stride', 'umee', 'regen'
]);

function toThorAddress(address: string): string | null {
	try {
		const decoded = bech32.decode(address);
		if (decoded.prefix === 'thor') return address;
		if (!COSMOS_SDK_PREFIXES.has(decoded.prefix)) return null;
		return bech32.encode('thor', decoded.words);
	} catch {
		return null;
	}
}

/**
 * Detect chain from address prefix. For 0x addresses returns 'ETH' as default
 * (compliance still matches regardless of EVM chain).
 */
function chainFromAddress(address: string): string | null {
	if (!address) return null;
	if (address.startsWith('thor')) return 'THOR';
	if (address.startsWith('cosmos')) return 'GAIA';
	if (address.startsWith('bc1') || /^[13][a-km-zA-HJ-NP-Z1-9]{25,}$/.test(address)) return 'BTC';
	if (address.startsWith('ltc1') || /^[LM][a-km-zA-HJ-NP-Z1-9]{25,}$/.test(address)) return 'LTC';
	if (address.startsWith('bnb')) return 'BNB';
	if (address.startsWith('0x') && address.length === 42) return 'ETH';
	if (address.startsWith('r') && address.length >= 25 && address.length <= 35) return 'XRP';
	if (address.startsWith('D') && address.length === 34) return 'DOGE';
	if (address.startsWith('bitcoincash:') || (address.startsWith('q') && address.length >= 42)) return 'BCH';
	if (address.startsWith('T') && address.length === 34) return 'TRX';
	return null;
}

async function fetchWithRetry(
	url: string,
	retries = 3,
	backoff = 1000
): Promise<Response> {
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(url);
			if (res.status === 429) {
				await new Promise((r) => setTimeout(r, backoff * Math.pow(2, i)));
				continue;
			}
			if (res.ok) return res;
			if (i === retries - 1) return res;
		} catch (error) {
			if (i === retries - 1) throw error;
			await new Promise((r) => setTimeout(r, backoff * Math.pow(2, i)));
		}
	}
	throw new Error(`Failed after ${retries} retries: ${url}`);
}

function chainFromAsset(asset: string): string {
	if (!asset) return 'UNKNOWN';
	// Handle: ETH.USDC-0x, ETH-USDC-0x, ETH~ETH, ETH/USDC, THOR.RUNE
	if (asset.includes('.')) return asset.split('.')[0] || 'UNKNOWN';
	if (asset.includes('~')) return asset.split('~')[0] || 'UNKNOWN';
	if (asset.includes('/')) return asset.split('/')[0] || 'UNKNOWN';
	return asset.split('-')[0] || 'UNKNOWN';
}

/**
 * Fetch ALL Rujira users from the League leaderboard via GraphQL cursor pagination.
 * This is the real Rujira user list (~3,500 users), not all 15k THORChain LPs.
 */
async function fetchAllRujiraUsers(): Promise<
	Array<{ address: string; points: string; rank: number; totalTx: number }>
> {
	const allUsers: Array<{
		address: string;
		points: string;
		rank: number;
		totalTx: number;
	}> = [];
	let hasNextPage = true;
	let cursor: string | null = null;

	while (hasNextPage) {
		const afterClause = cursor ? `, after: "${cursor}"` : '';
		const query = `{
			league {
				leaderboard(first: 100, sortBy: RANK, sortDir: ASC${afterClause}) {
					edges {
						node {
							address
							points
							rank
							totalTx
						}
					}
					pageInfo {
						hasNextPage
						endCursor
					}
				}
			}
		}`;

		const res = await fetch(RUJIRA_GQL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query })
		});

		if (!res.ok) throw new Error(`Rujira GQL failed: ${res.status}`);

		const data = await res.json();
		const league = data?.data?.league?.[0];
		if (!league) throw new Error('No league data returned');

		const edges = league.leaderboard?.edges || [];
		for (const edge of edges) {
			allUsers.push(edge.node);
		}

		hasNextPage = league.leaderboard?.pageInfo?.hasNextPage || false;
		cursor = league.leaderboard?.pageInfo?.endCursor || null;
	}

	return allUsers;
}

/**
 * Step 1: Fetch ALL Rujira users from League leaderboard and bulk insert.
 * - thor1 addresses: insert directly
 * - cosmos1/osmo1/etc bech32: convert to thor1 (same key), store original as L1 with chain GAIA
 * - 0x/bc1/ltc1: resolve to thor via Midgard actions, store original as L1
 */
export async function syncAllMembers(): Promise<{
	total: number;
	newUsers: number;
	converted: number;
	duration: number;
}> {
	const start = Date.now();

	try {
		const rujiraMembers = await fetchAllRujiraUsers();
		let newUsers = 0;
		let converted = 0;

		// Get existing users
		const existing = await db
			.select({ thorAddress: rujiraUsers.thorAddress })
			.from(rujiraUsers);
		const existingSet = new Set(existing.map((e) => e.thorAddress));

		// Separate thor addresses from non-thor
		const thorMembers: typeof rujiraMembers = [];
		const nonThorMembers: typeof rujiraMembers = [];

		for (const m of rujiraMembers) {
			if (m.address.startsWith('thor')) {
				thorMembers.push(m);
			} else {
				nonThorMembers.push(m);
			}
		}

		// Insert thor addresses directly
		const toInsert = thorMembers.filter((m) => !existingSet.has(m.address));
		for (let i = 0; i < toInsert.length; i += 500) {
			const chunk = toInsert.slice(i, i + 500);
			await db
				.insert(rujiraUsers)
				.values(chunk.map((m) => ({ thorAddress: m.address })))
				.onConflictDoNothing();
			newUsers += chunk.length;
		}

		// Convert non-thor bech32 addresses (cosmos1, etc.) to thor1
		for (const m of nonThorMembers) {
			const thorAddr = toThorAddress(m.address);
			if (!thorAddr) continue; // skip non-bech32 (0x, bc1, etc.)

			converted++;

			// Insert the derived thor address as a user
			if (!existingSet.has(thorAddr)) {
				await db.insert(rujiraUsers)
					.values({ thorAddress: thorAddr })
					.onConflictDoNothing();
				existingSet.add(thorAddr);
				newUsers++;
			}

			// Store the original address as a linked L1
			const addrChain = chainFromAddress(m.address) || 'GAIA';
			await db.insert(l1Addresses).values({
				thorAddress: thorAddr,
				l1Address: m.address,
				chain: addrChain,
				pool: `${addrChain}.ATOM`
			}).onConflictDoNothing();
		}

		// Auto-link cosmos address for every thor user (same key, free compliance coverage)
		const allThorUsers = [...existingSet];
		for (let i = 0; i < allThorUsers.length; i += 100) {
			const batch = allThorUsers.slice(i, i + 100);
			const cosmosLinks = batch.map((thorAddr) => {
				try {
					const decoded = bech32.decode(thorAddr);
					const cosmosAddr = bech32.encode('cosmos', decoded.words);
					return { thorAddress: thorAddr, l1Address: cosmosAddr, chain: 'GAIA' };
				} catch { return null; }
			}).filter(Boolean) as { thorAddress: string; l1Address: string; chain: string }[];

			if (cosmosLinks.length > 0) {
				await db.insert(l1Addresses)
					.values(cosmosLinks)
					.onConflictDoNothing();
			}
		}

		// Update lastSeen for all
		await db.update(rujiraUsers).set({ lastSeen: new Date() });

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'MIDGARD',
			status: 'success',
			recordsProcessed: rujiraMembers.length,
			flagsFound: newUsers,
			duration
		});

		return { total: rujiraMembers.length, newUsers, converted, duration };
	} catch (error) {
		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'MIDGARD',
			status: 'error',
			recordsProcessed: 0,
			flagsFound: 0,
			error: String(error),
			duration
		});
		throw error;
	}
}

/**
 * Step 2: Fetch L1 addresses for a single thor address from Midgard.
 */
export async function fetchL1ForUser(thorAddress: string): Promise<{
	found: number;
	pools: string[];
}> {
	let found = 0;
	const poolNames: string[] = [];

	// 1. Check LP membership
	try {
		const res = await fetchWithRetry(
			`${MIDGARD_URL()}/v2/member/${thorAddress}`
		);
		if (res.ok) {
			const detail = await res.json();
			const pools = detail?.pools || [];

			for (const pool of pools) {
				if (!pool.assetAddress) continue;

				const chain = chainFromAddress(pool.assetAddress) || chainFromAsset(pool.pool);
				poolNames.push(pool.pool);

				await db.insert(l1Addresses).values({
					thorAddress,
					l1Address: pool.assetAddress,
					chain,
					pool: pool.pool
				}).onConflictDoNothing();
				found++;
			}
		}
	} catch { /* no LP positions */ }

	// 2. Scan ALL actions for L1 addresses (swaps, sends, etc.) — full pagination
	try {
		const pageSize = 50;
		const maxPages = 100;
		let nextPageToken: string | null = null;

		for (let page = 0; page < maxPages; page++) {
			let url = `${MIDGARD_URL()}/v2/actions?address=${thorAddress}&limit=${pageSize}`;
			if (nextPageToken) {
				url += `&nextPageToken=${nextPageToken}`;
			} else if (page > 0) {
				break;
			}

			const res = await fetchWithRetry(url);
			if (!res.ok) break;
			const data = await res.json();
			const actions = data?.actions || [];
			if (actions.length === 0) break;

			for (const action of actions) {
				for (const io of [...(action.in || []), ...(action.out || [])]) {
					const addr = io.address;
					if (!addr || addr.startsWith('thor')) continue;
					const asset = io.coins?.[0]?.asset || '';
					// Prefer address-based chain detection, fall back to asset-based
					const chain = chainFromAddress(addr) || (asset ? chainFromAsset(asset) : null);
					if (!chain || chain === 'UNKNOWN') continue;

					await db.insert(l1Addresses).values({
						thorAddress,
						l1Address: addr,
						chain,
						pool: asset || `${chain}.unknown`
					}).onConflictDoNothing();
					found++;
				}
			}

			nextPageToken = data?.meta?.nextPageToken || null;
			if (!nextPageToken || actions.length < pageSize) break;

			await new Promise(r => setTimeout(r, 150));
		}
	} catch { /* action scan failed */ }

	return { found, pools: poolNames };
}

/**
 * Step 2 (streaming): Fetch L1 addresses for all users, yielding progress.
 */
export async function* fetchL1AddressesStreaming(
	batchSize = 10,
	concurrency = 4
): AsyncGenerator<{
	processed: number;
	total: number;
	currentAddress: string;
	l1Found: number;
}> {
	const allUsers = await db
		.select({ thorAddress: rujiraUsers.thorAddress })
		.from(rujiraUsers);

	// Only fetch for thor addresses (they have associated L1 addresses on Midgard)
	const thorUsers = allUsers.filter((u) => u.thorAddress.startsWith('thor'));
	const total = thorUsers.length;
	const limit = pLimit(concurrency);
	let processed = 0;

	for (let i = 0; i < thorUsers.length; i += batchSize) {
		const batch = thorUsers.slice(i, i + batchSize);

		const results = await Promise.allSettled(
			batch.map((user) =>
				limit(async () => {
					const result = await fetchL1ForUser(user.thorAddress);
					return { address: user.thorAddress, ...result };
				})
			)
		);

		for (const result of results) {
			processed++;
			if (result.status === 'fulfilled') {
				yield {
					processed,
					total,
					currentAddress: result.value.address,
					l1Found: result.value.found
				};
			}
		}
	}
}
