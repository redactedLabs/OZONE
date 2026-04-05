import { db } from '../db';
import {
	complianceEntries,
	rujiraUsers,
	l1Addresses,
	syncLog
} from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

interface ScreenMatch {
	address: string;
	chain: string;
	source: string;
	entityName: string | null;
	reason: string | null;
}

interface ScreeningResult {
	totalScreened: number;
	flagged: number;
	matches: Array<{
		thorAddress: string;
		l1Address: string;
		chain: string;
		matchSource: string;
		entityName: string | null;
	}>;
	duration: number;
}

function normalizeAddress(address: string, chain: string): string {
	if (chain === 'ETH' || chain === 'BSC' || chain === 'ARB') {
		return address.toLowerCase();
	}
	return address;
}

async function checkChainalysis(address: string): Promise<ScreenMatch | null> {
	const apiKey = env.CHAINALYSIS_API_KEY;
	if (!apiKey) return null;

	try {
		const res = await fetch(
			`https://public.chainalysis.com/api/v1/address/${address}`,
			{ headers: { 'X-API-Key': apiKey, Accept: 'application/json' } }
		);

		if (!res.ok) return null;

		const data = await res.json();
		if (data.identifications && data.identifications.length > 0) {
			const id = data.identifications[0];
			return {
				address,
				chain: 'ETH',
				source: 'CHAINALYSIS',
				entityName: id.name || id.category || 'Flagged by Chainalysis',
				reason: id.description || id.category || 'Chainalysis sanctions match'
			};
		}
	} catch {
		// Silent fail for Chainalysis
	}

	return null;
}

export async function screenAllUsers(): Promise<ScreeningResult> {
	const start = Date.now();

	try {
		// 1. Get all L1 addresses
		const allL1 = await db.select().from(l1Addresses);

		// 2. Get all compliance entries for quick lookup
		const allCompliance = await db.select().from(complianceEntries);
		const complianceMap = new Map<string, typeof allCompliance[0]>();
		for (const entry of allCompliance) {
			complianceMap.set(entry.address, entry);
		}

		const matches: ScreeningResult['matches'] = [];
		const flaggedThorAddresses = new Set<string>();

		// 3. Screen each L1 address
		for (const l1 of allL1) {
			const normalized = normalizeAddress(l1.l1Address, l1.chain);

			// Check against local compliance DB
			const match = complianceMap.get(normalized);
			if (match) {
				matches.push({
					thorAddress: l1.thorAddress,
					l1Address: l1.l1Address,
					chain: l1.chain,
					matchSource: match.source,
					entityName: match.entityName
				});
				flaggedThorAddresses.add(l1.thorAddress);
				continue;
			}

			// Check ETH addresses against Chainalysis
			if (l1.chain === 'ETH' || l1.chain === 'BSC' || l1.chain === 'ARB') {
				const chainalysisMatch = await checkChainalysis(normalized);
				if (chainalysisMatch) {
					matches.push({
						thorAddress: l1.thorAddress,
						l1Address: l1.l1Address,
						chain: l1.chain,
						matchSource: 'CHAINALYSIS',
						entityName: chainalysisMatch.entityName
					});
					flaggedThorAddresses.add(l1.thorAddress);
				}
			}
		}

		// 4. Update user flags
		const allUsers = await db.select().from(rujiraUsers);
		for (const user of allUsers) {
			const isFlagged = flaggedThorAddresses.has(user.thorAddress);
			const flagReason = isFlagged
				? matches
						.filter((m) => m.thorAddress === user.thorAddress)
						.map((m) => `${m.matchSource}: ${m.entityName} (${m.l1Address})`)
						.join('; ')
				: null;

			await db
				.update(rujiraUsers)
				.set({
					flagged: isFlagged,
					flagReason,
					screenedAt: new Date()
				})
				.where(eq(rujiraUsers.id, user.id));
		}

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'SCREEN',
			status: 'success',
			recordsProcessed: allL1.length,
			flagsFound: flaggedThorAddresses.size,
			duration
		});

		return {
			totalScreened: allL1.length,
			flagged: flaggedThorAddresses.size,
			matches,
			duration
		};
	} catch (error) {
		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'SCREEN',
			status: 'error',
			recordsProcessed: 0,
			flagsFound: 0,
			error: String(error),
			duration
		});
		throw error;
	}
}

export async function screenSingleAddress(
	address: string
): Promise<{
	address: string;
	flagged: boolean;
	matches: ScreenMatch[];
}> {
	const normalizedLower = address.toLowerCase();
	const matches: ScreenMatch[] = [];

	// Check all normalized forms
	const allCompliance = await db.select().from(complianceEntries);

	for (const entry of allCompliance) {
		if (
			entry.address === address ||
			entry.address === normalizedLower ||
			entry.address.toLowerCase() === normalizedLower
		) {
			matches.push({
				address: entry.address,
				chain: entry.chain || 'UNKNOWN',
				source: entry.source,
				entityName: entry.entityName,
				reason: entry.reason
			});
		}
	}

	// Chainalysis check
	const chainalysisMatch = await checkChainalysis(address);
	if (chainalysisMatch) {
		matches.push(chainalysisMatch);
	}

	return {
		address,
		flagged: matches.length > 0,
		matches
	};
}
