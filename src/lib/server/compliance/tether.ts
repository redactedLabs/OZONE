import { db } from '../db';
import { complianceEntries, syncLog } from '../db/schema';
import { env } from '$env/dynamic/private';
import { eq, sql } from 'drizzle-orm';
import bs58check from 'bs58check';

/**
 * Tether (USDT) frozen/blacklisted addresses — live on-chain event scanning.
 * APPEND-ONLY: entries are NEVER deleted. Once an address has been blacklisted,
 * it stays in the DB forever. Removed addresses get their reason updated.
 *
 * Sources:
 * - Ethereum: USDT contract AddedBlackList / RemovedBlackList events via Etherscan V2 API
 * - TRON: USDT-TRC20 contract AddedBlackList / RemovedBlackList events via TronGrid API
 * - Hardcoded baseline for known ETH frozen addresses (fallback)
 */

const USDT_ETH_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
// keccak256("AddedBlackList(address)")
const ETH_ADDED_TOPIC = '0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc';
// keccak256("RemovedBlackList(address)")
const ETH_REMOVED_TOPIC = '0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c';

const TRONGRID_API = 'https://api.trongrid.io/v1/contracts';
const USDT_TRON_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** Convert 0x hex address from TronGrid events to TRON base58 T... address */
function hexToTronAddress(hex: string): string {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	return bs58check.encode(Buffer.from('41' + clean, 'hex'));
}

// Known frozen addresses from public Dune/community datasets as a baseline
const KNOWN_TETHER_FROZEN: Array<{ address: string; chain: string }> = [
	{ address: '0xefbaaf73fc22f70785515c1e2be3d5ba2fb8e9b0', chain: 'ETH' },
	{ address: '0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a', chain: 'ETH' },
	{ address: '0x7db418b5d567a4e0e8c59ad71be1fce48f3e6107', chain: 'ETH' },
	{ address: '0x72a5843cc08275c8171e582972aa4fda8c397b2a', chain: 'ETH' },
	{ address: '0x7f367cc41522ce07553e823bf3be79a889dede1b', chain: 'ETH' },
	{ address: '0x7ff9cfad3877f21d41da833eb7f3c97c4dc108c0', chain: 'ETH' },
	{ address: '0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b', chain: 'ETH' },
	{ address: '0x901bb9583b24d97e995513c6778dc6888ab6870e', chain: 'ETH' },
	{ address: '0xa7e5d5a720f06526557c513402f2e6b5fa20b008', chain: 'ETH' },
	{ address: '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c', chain: 'ETH' },
	{ address: '0xc455f7fd3e0e12afd51fba5c106909934d8a0e4a', chain: 'ETH' },
	{ address: '0xfec8a60023265364d066a1212fde3930f6ae9d65', chain: 'ETH' },
	{ address: '0x308ed4b7b49797e1a98d3818bff6fe5385410370', chain: 'ETH' },
	{ address: '0x67d40ee1a85bf4a4bb7ffae16de985e8427b6b45', chain: 'ETH' },
	{ address: '0x6acdfba02d390b97ac2b2d42a63e85293bcc160e', chain: 'ETH' },
	{ address: '0x6f1ca141a28907f78ebaa64fb83a9088b02a8352', chain: 'ETH' },
	{ address: '0xfae0c6cfce04e3b2ec2de088bce4ef978feb4047', chain: 'ETH' },
];

export async function syncTether(): Promise<{
	count: number;
	ethCount: number;
	tronCount: number;
	hardcodedCount: number;
	duration: number;
}> {
	const start = Date.now();

	try {
		// SAFETY: Count existing TETHER entries BEFORE doing anything
		const [beforeCount] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(complianceEntries)
			.where(eq(complianceEntries.source, 'TETHER'));
		const existingCount = beforeCount?.count || 0;

		// Collect ALL addresses that have EVER been blacklisted (append-only)
		const addedAddresses: Array<{ address: string; chain: string }> = [
			...KNOWN_TETHER_FROZEN,
		];
		const hardcodedCount = KNOWN_TETHER_FROZEN.length;

		// Fetch ALL AddedBlackList events from ETH (not subtracting removed)
		const ethAdded = await fetchAllAddedETH();
		addedAddresses.push(...ethAdded);

		// Fetch ALL AddedBlackList events from TRON (not subtracting removed)
		const tronAdded = await fetchAllAddedTRON();
		addedAddresses.push(...tronAdded);

		// Deduplicate
		const seen = new Set<string>();
		const unique = addedAddresses.filter((a) => {
			const key = `${a.chain}:${a.address.toLowerCase()}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		let upserted = 0;

		// Batch upsert in chunks of 100
		for (let i = 0; i < unique.length; i += 100) {
			const chunk = unique.slice(i, i + 100);
			const values = chunk.map((entry) => ({
				address: entry.chain === 'ETH' ? entry.address.toLowerCase() : entry.address,
				chain: entry.chain,
				source: 'TETHER' as const,
				entityName: 'Tether Frozen',
				reason: `USDT blacklisted address (${entry.chain})`
			}));

			await db.insert(complianceEntries).values(values).onConflictDoUpdate({
				target: [complianceEntries.address, complianceEntries.source],
				set: { lastSeen: new Date() }
			});
			upserted += chunk.length;
		}

		// Now fetch removed addresses and mark them (but NEVER delete)
		const ethRemoved = await fetchEtherscanEvents(ETH_REMOVED_TOPIC);
		const tronRemoved = await fetchTronGridEvents('RemovedBlackList');
		const removedSet = new Set([
			...ethRemoved.map(a => a.toLowerCase()),
			...tronRemoved.map(a => a.toLowerCase()),
		]);

		// Mark removed addresses with updated reason (still kept in DB)
		if (removedSet.size > 0) {
			const removedArr = [...removedSet];
			for (let i = 0; i < removedArr.length; i += 100) {
				const chunk = removedArr.slice(i, i + 100);
				for (const addr of chunk) {
					await db.update(complianceEntries)
						.set({
							reason: `USDT address (unfrozen by Tether)`,
							lastSeen: new Date()
						})
						.where(
							sql`address = ${addr} AND source = 'TETHER'`
						);
				}
			}
		}

		// SAFETY CHECK: verify count didn't decrease
		const [afterCount] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(complianceEntries)
			.where(eq(complianceEntries.source, 'TETHER'));
		const finalCount = afterCount?.count || 0;

		if (finalCount < existingCount) {
			// This should NEVER happen. Log critical error.
			console.error(`[TETHER SYNC CRITICAL] Count decreased: ${existingCount} → ${finalCount}. This should never happen!`);
			await db.insert(syncLog).values({
				type: 'TETHER',
				status: 'error',
				recordsProcessed: upserted,
				flagsFound: 0,
				error: `SAFETY: Count decreased from ${existingCount} to ${finalCount}! Possible data loss.`,
				duration: Date.now() - start
			});
		}

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'TETHER',
			status: 'success',
			recordsProcessed: finalCount,
			flagsFound: removedSet.size,
			duration
		});

		return {
			count: finalCount,
			ethCount: ethAdded.length,
			tronCount: tronAdded.length,
			hardcodedCount,
			duration
		};
	} catch (error) {
		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'TETHER',
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
 * Fetch all event logs matching a topic from Etherscan V2 API with pagination.
 * Address is a non-indexed param in `data` (not topics[1]).
 */
async function fetchEtherscanEvents(topic0: string): Promise<string[]> {
	const apiKey = env.ETHERSCAN_API_KEY;
	if (!apiKey) return [];

	const addresses: string[] = [];
	let page = 1;
	const perPage = 10000;

	const maxPages = 10; // Safety cap: 10 × 10000 = 100K events max

	while (page <= maxPages) {
		const url = `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs` +
			`&address=${USDT_ETH_CONTRACT}&topic0=${topic0}` +
			`&startblock=0&endblock=latest&page=${page}&offset=${perPage}` +
			`&apikey=${apiKey}`;

		const res = await fetch(url);
		if (!res.ok) break;

		const data = await res.json();
		if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) break;

		for (const log of data.result) {
			const raw = log.data;
			if (raw && raw.length >= 66) {
				const addr = '0x' + raw.slice(26, 66);
				if (addr !== '0x0000000000000000000000000000000000000000') {
					addresses.push(addr.toLowerCase());
				}
			}
		}

		if (data.result.length < perPage) break;
		page++;
	}

	return addresses;
}

/**
 * Fetch ALL AddedBlackList ETH addresses (no subtraction).
 * Returns unique addresses only.
 */
async function fetchAllAddedETH(): Promise<Array<{ address: string; chain: string }>> {
	try {
		const added = await fetchEtherscanEvents(ETH_ADDED_TOPIC);
		const unique = [...new Set(added)];
		return unique.map((addr) => ({ address: addr, chain: 'ETH' }));
	} catch {
		return [];
	}
}

/**
 * Fetch all events of a given type from TronGrid with full pagination.
 */
async function fetchTronGridEvents(eventName: string): Promise<string[]> {
	const apiKey = env.TRONGRID_API_KEY;
	const addresses: string[] = [];
	let url: string | null = `${TRONGRID_API}/${USDT_TRON_CONTRACT}/events?event_name=${eventName}&limit=200`;
	const headers: Record<string, string> = {};
	if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

	let pages = 0;
	const maxPages = 500; // Safety cap: 500 pages × 200 events = 100K events max

	while (url && pages < maxPages) {
		let res = await fetch(url, { headers });

		// Retry on 429 with exponential backoff (up to 3 attempts)
		for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
			await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
			res = await fetch(url, { headers });
		}
		if (!res.ok) break;

		const data = await res.json();
		if (!data.success || !Array.isArray(data.data) || data.data.length === 0) break;

		for (const event of data.data) {
			const rawAddr = event.result?._user || event.result?.user;
			if (rawAddr) {
				const addr = rawAddr.startsWith('0x') ? hexToTronAddress(rawAddr) : rawAddr;
				addresses.push(addr);
			}
		}

		pages++;
		url = data.meta?.links?.next || null;
		if (url) await new Promise((r) => setTimeout(r, apiKey ? 600 : 1500));
	}

	return addresses;
}

/**
 * Fetch ALL AddedBlackList TRON addresses (no subtraction).
 * Returns unique addresses only.
 */
async function fetchAllAddedTRON(): Promise<Array<{ address: string; chain: string }>> {
	try {
		const added = await fetchTronGridEvents('AddedBlackList');
		const unique = [...new Set(added)];
		return unique.map((addr) => ({ address: addr, chain: 'TRX' }));
	} catch {
		return [];
	}
}
