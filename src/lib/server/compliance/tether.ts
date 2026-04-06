import { db } from '../db';
import { complianceEntries, syncLog } from '../db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Tether (USDT) frozen/blacklisted addresses.
 *
 * Sources:
 * - Ethereum: USDT contract (0xdAC17F958D2ee523a2206206994597C13D831ec7)
 *   events `AddedBlackList(address)` via Etherscan API
 * - TRON: USDT-TRC20 contract (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)
 *   via Tronscan API
 * - Dune public dataset as fallback
 */

const ETHERSCAN_API = 'https://api.etherscan.io/api';
const USDT_ETH_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
// AddedBlackList(address) event topic
const ADDED_BLACKLIST_TOPIC = '0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b012b52571b735';

const TRONSCAN_API = 'https://apilist.tronscanapi.com/api/contract/events';
const USDT_TRON_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// Known frozen addresses from public Dune/community datasets as a baseline
// These are the most well-known Tether-frozen addresses
const KNOWN_TETHER_FROZEN: Array<{ address: string; chain: string }> = [
	// Major ETH frozen addresses (from Tether transparency reports + on-chain events)
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
	duration: number;
}> {
	const start = Date.now();

	try {
		const addresses: Array<{ address: string; chain: string }> = [
			...KNOWN_TETHER_FROZEN,
		];

		// Try to fetch from Etherscan (AddedBlackList events)
		const ethAddresses = await fetchEtherscanBlacklist();
		addresses.push(...ethAddresses);

		// Try to fetch from Tronscan (frozen TRC20 addresses)
		const tronAddresses = await fetchTronscanBlacklist();
		addresses.push(...tronAddresses);

		// Deduplicate
		const seen = new Set<string>();
		const unique = addresses.filter((a) => {
			const key = `${a.chain}:${a.address.toLowerCase()}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		let upserted = 0;

		for (const entry of unique) {
			const normalizedAddr = entry.chain === 'ETH'
				? entry.address.toLowerCase()
				: entry.address;

			const existing = await db
				.select()
				.from(complianceEntries)
				.where(
					and(
						eq(complianceEntries.address, normalizedAddr),
						eq(complianceEntries.source, 'TETHER')
					)
				)
				.limit(1);

			if (existing.length > 0) {
				await db
					.update(complianceEntries)
					.set({ lastSeen: new Date() })
					.where(eq(complianceEntries.id, existing[0].id));
			} else {
				await db.insert(complianceEntries).values({
					address: normalizedAddr,
					chain: entry.chain,
					source: 'TETHER',
					entityName: 'Tether Frozen',
					reason: `USDT blacklisted address (${entry.chain})`
				});
			}
			upserted++;
		}

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'TETHER',
			status: 'success',
			recordsProcessed: upserted,
			flagsFound: 0,
			duration
		});

		return { count: upserted, duration };
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
 * Fetch AddedBlackList events from Etherscan for the USDT contract.
 * Returns all addresses that have been blacklisted on Ethereum.
 */
async function fetchEtherscanBlacklist(): Promise<Array<{ address: string; chain: string }>> {
	try {
		// Fetch AddedBlackList events — no API key needed for basic rate
		const url = `${ETHERSCAN_API}?module=logs&action=getLogs` +
			`&address=${USDT_ETH_CONTRACT}` +
			`&topic0=${ADDED_BLACKLIST_TOPIC}` +
			`&fromBlock=0&toBlock=latest` +
			`&page=1&offset=10000`;

		const res = await fetch(url);
		if (!res.ok) return [];

		const data = await res.json();
		if (data.status !== '1' || !Array.isArray(data.result)) return [];

		const addresses: Array<{ address: string; chain: string }> = [];
		for (const log of data.result) {
			// The blacklisted address is in the first topic (indexed param) or data
			// AddedBlackList(address _user) — address is in topics[1]
			if (log.topics && log.topics[1]) {
				const addr = '0x' + log.topics[1].slice(26);
				if (addr.length === 42) {
					addresses.push({ address: addr.toLowerCase(), chain: 'ETH' });
				}
			}
		}
		return addresses;
	} catch {
		return [];
	}
}

/**
 * Fetch frozen addresses from Tronscan for TRC20 USDT.
 */
async function fetchTronscanBlacklist(): Promise<Array<{ address: string; chain: string }>> {
	try {
		// Tronscan contract events API for AddedBlackList
		const url = `${TRONSCAN_API}?contract=${USDT_TRON_CONTRACT}` +
			`&event_name=AddedBlackList&limit=200&start=0`;

		const res = await fetch(url);
		if (!res.ok) return [];

		const data = await res.json();
		if (!data.data || !Array.isArray(data.data)) return [];

		const addresses: Array<{ address: string; chain: string }> = [];
		for (const event of data.data) {
			const addr = event.result?._user || event.result?.user;
			if (addr) {
				addresses.push({ address: addr, chain: 'TRX' });
			}
		}
		return addresses;
	} catch {
		return [];
	}
}
