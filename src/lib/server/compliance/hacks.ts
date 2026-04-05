import { db } from '../db';
import { complianceEntries, syncLog } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

interface HackEntry {
	address: string;
	chain: string;
	incident: string;
	estimatedUSD?: number;
	date: string;
	source: string;
}

export const KNOWN_HACK_ADDRESSES: HackEntry[] = [
	// Bybit Hack - Feb 2025 (Lazarus Group)
	{ address: '0x47666fab8bd0ac7003bce3f5c3585383f09486e2', chain: 'ETH', incident: 'Bybit Hack Feb 2025', estimatedUSD: 1_400_000_000, date: '2025-02-21', source: 'ZachXBT / FBI' },
	{ address: '0xa4b2b3fcd8b63f2e45109503391afc6db0e150fa', chain: 'ETH', incident: 'Bybit Hack Feb 2025', estimatedUSD: 1_400_000_000, date: '2025-02-21', source: 'ZachXBT' },
	{ address: '0x3d487a30e4fce5e0455601baa96025f498a19148', chain: 'ETH', incident: 'Bybit Hack Feb 2025', estimatedUSD: 1_400_000_000, date: '2025-02-21', source: 'Elliptic' },
	{ address: '0xdd90071d52ee5a3e1c3487df534e37fe29851878', chain: 'ETH', incident: 'Bybit Hack Feb 2025', estimatedUSD: 1_400_000_000, date: '2025-02-21', source: 'Elliptic' },
	{ address: '0xefd8a24dc25b8cf0a44f9462a0b3e29db592cebe', chain: 'ETH', incident: 'Bybit Hack Feb 2025', estimatedUSD: 1_400_000_000, date: '2025-02-21', source: 'FBI' },

	// Ronin Bridge Hack - March 2022 (Lazarus Group)
	{ address: '0x098b716b8aaf21512996dc57eb0615e2383e2f96', chain: 'ETH', incident: 'Ronin Bridge Hack 2022', estimatedUSD: 625_000_000, date: '2022-03-23', source: 'FBI / OFAC' },
	{ address: '0x4f3a120e72c76c22ae802d129f599bfdbc31cb81', chain: 'ETH', incident: 'Ronin Bridge Hack 2022', estimatedUSD: 625_000_000, date: '2022-03-23', source: 'Chainalysis' },

	// Nomad Bridge Hack - August 2022
	{ address: '0x56d8b635a7c88fd1104d23d632af40c1c3aac4e3', chain: 'ETH', incident: 'Nomad Bridge Hack 2022', estimatedUSD: 190_000_000, date: '2022-08-01', source: 'Chainalysis' },
	{ address: '0xb5c55f76f90cc528b2609109ca14d8d84b9df1cf', chain: 'ETH', incident: 'Nomad Bridge Hack 2022', estimatedUSD: 190_000_000, date: '2022-08-01', source: 'PeckShield' },

	// Harmony Horizon Bridge - June 2022 (Lazarus Group)
	{ address: '0x0d043128146654c7683fbf30ac98d7b2285ded00', chain: 'ETH', incident: 'Harmony Horizon Bridge 2022', estimatedUSD: 100_000_000, date: '2022-06-23', source: 'FBI' },
	{ address: '0x9e91ae672e7f7330fc6b8c2b96cc36509e55e3b4', chain: 'ETH', incident: 'Harmony Horizon Bridge 2022', estimatedUSD: 100_000_000, date: '2022-06-23', source: 'Elliptic' },

	// KuCoin Hack - September 2020 (Lazarus Group)
	{ address: '0xeb31973e0febf3e3d7058234a5ebbae1ab4b8c23', chain: 'ETH', incident: 'KuCoin Hack 2020', estimatedUSD: 281_000_000, date: '2020-09-26', source: 'Chainalysis' },
	{ address: '0x735d5c91d36f4ff9f3d20b47c8af4c7a200d4ddf', chain: 'ETH', incident: 'KuCoin Hack 2020', estimatedUSD: 281_000_000, date: '2020-09-26', source: 'SlowMist' },

	// Atomic Wallet Hack - June 2023 (Lazarus Group)
	{ address: '0x30956e2fdbf5d5d9e16fce1b4b0e62c0fcbe1ea5', chain: 'ETH', incident: 'Atomic Wallet Hack 2023', estimatedUSD: 100_000_000, date: '2023-06-03', source: 'Elliptic' },

	// Stake.com Hack - September 2023 (Lazarus Group)
	{ address: '0x3130662aeac0e1a2a0a0b9e8d3b57f30e tried6f', chain: 'ETH', incident: 'Stake.com Hack 2023', estimatedUSD: 41_000_000, date: '2023-09-04', source: 'FBI' },

	// WazirX Hack - July 2024
	{ address: '0x04b21735e93fa3f36b6e1e3413468ae60b6b0002', chain: 'ETH', incident: 'WazirX Hack 2024', estimatedUSD: 230_000_000, date: '2024-07-18', source: 'ZachXBT' },

	// Lazarus Group BTC addresses
	{ address: 'bc1qnxpnk40mq7s93uaem8yxmffjj0dwvv9ra6n7p', chain: 'BTC', incident: 'Lazarus Group BTC', estimatedUSD: 0, date: '2024-01-01', source: 'OFAC' },
	{ address: '3HMHpWQPRGCCg1VGwreiSjEtaqLW8kNbMF', chain: 'BTC', incident: 'Lazarus Group BTC', estimatedUSD: 0, date: '2022-04-14', source: 'OFAC' },

	// Tornado Cash deployer
	{ address: '0x905b63fff465b9ffbf41dea908ceb12de60340e5', chain: 'ETH', incident: 'Tornado Cash', estimatedUSD: 0, date: '2022-08-08', source: 'OFAC' },

	// Known Lazarus Group / DPRK cluster
	{ address: '0x53b6936513e738f44fb50d2b9476730c0ab3bfc1', chain: 'ETH', incident: 'Lazarus Group Cluster', estimatedUSD: 0, date: '2023-01-01', source: 'Elliptic' },
	{ address: '0x0583a9d956e0be22c2fea0e39bf263e3d1e72701', chain: 'ETH', incident: 'Lazarus Group Cluster', estimatedUSD: 0, date: '2023-01-01', source: 'Chainalysis' },
];

export async function syncHackList(): Promise<{
	count: number;
	duration: number;
}> {
	const start = Date.now();

	try {
		let upserted = 0;

		for (const entry of KNOWN_HACK_ADDRESSES) {
			const normalizedAddr =
				entry.chain === 'ETH'
					? entry.address.toLowerCase()
					: entry.address;

			const existing = await db
				.select()
				.from(complianceEntries)
				.where(
					and(
						eq(complianceEntries.address, normalizedAddr),
						eq(complianceEntries.source, 'HACK')
					)
				)
				.limit(1);

			if (existing.length > 0) {
				await db
					.update(complianceEntries)
					.set({
						lastSeen: new Date(),
						entityName: entry.incident,
						reason: `${entry.incident} (${entry.source})`
					})
					.where(eq(complianceEntries.id, existing[0].id));
			} else {
				await db.insert(complianceEntries).values({
					address: normalizedAddr,
					chain: entry.chain,
					source: 'HACK',
					entityName: entry.incident,
					reason: `${entry.incident} — est. $${entry.estimatedUSD?.toLocaleString()} (${entry.source})`
				});
			}
			upserted++;
		}

		// Optional: Chainalysis API check
		if (env.CHAINALYSIS_API_KEY) {
			// Chainalysis integration is available but we only use it for on-demand screening
		}

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'HACK',
			status: 'success',
			recordsProcessed: upserted,
			flagsFound: 0,
			duration
		});

		return { count: upserted, duration };
	} catch (error) {
		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'HACK',
			status: 'error',
			recordsProcessed: 0,
			flagsFound: 0,
			error: String(error),
			duration
		});
		throw error;
	}
}
