import { XMLParser } from 'fast-xml-parser';
import { db } from '../db';
import { complianceEntries, syncLog } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const EU_SANCTIONS_URL =
	'https://webgate.ec.europa.eu/europeaid/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content';

// Regex patterns for crypto addresses
const CRYPTO_PATTERNS: Record<string, RegExp> = {
	ETH: /\b0x[a-fA-F0-9]{40}\b/g,
	BTC: /\b(bc1[a-zA-HJ-NP-Z0-9]{25,39}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
	TRX: /\bT[a-zA-Z0-9]{33}\b/g
};

interface EUEntry {
	address: string;
	chain: string;
	entityName: string;
}

function extractCryptoFromText(text: string, entityName: string): EUEntry[] {
	const entries: EUEntry[] = [];
	for (const [chain, pattern] of Object.entries(CRYPTO_PATTERNS)) {
		// Reset regex state
		pattern.lastIndex = 0;
		const matches = text.match(pattern);
		if (matches) {
			for (const addr of matches) {
				entries.push({ address: addr, chain, entityName });
			}
		}
	}
	return entries;
}

export async function syncEU(): Promise<{ count: number; duration: number }> {
	const start = Date.now();

	try {
		// EU endpoint can be slow/unreliable — use a longer timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 60000);

		let response: Response;
		try {
			response = await fetch(EU_SANCTIONS_URL, {
				signal: controller.signal,
				headers: { 'Accept': 'application/xml' }
			});
		} catch (fetchError: any) {
			if (fetchError.name === 'AbortError') {
				throw new Error('EU sanctions fetch timed out after 60s');
			}
			throw fetchError;
		} finally {
			clearTimeout(timeout);
		}

		if (!response.ok) {
			throw new Error(`EU fetch failed: ${response.status} ${response.statusText}`);
		}

		const xml = await response.text();

		if (!xml || xml.length < 100) {
			throw new Error('EU XML response was empty or too short');
		}

		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_'
		});
		const data = parser.parse(xml);

		const entries: EUEntry[] = [];

		// Try to traverse the XML - structure varies
		const root = data?.export || data?.sanctionsList || data;
		const xmlStr = xml;

		// Scan the entire XML text for crypto address patterns
		// This is more reliable than trying to navigate the complex EU XML structure
		const allCryptoMatches = extractCryptoFromText(xmlStr, 'EU Sanctions Entity');
		entries.push(...allCryptoMatches);

		let upserted = 0;
		const seen = new Set<string>();

		for (const entry of entries) {
			const normalizedAddr = entry.chain === 'ETH'
				? entry.address.toLowerCase()
				: entry.address;

			if (seen.has(normalizedAddr)) continue;
			seen.add(normalizedAddr);

			const existing = await db
				.select()
				.from(complianceEntries)
				.where(
					and(
						eq(complianceEntries.address, normalizedAddr),
						eq(complianceEntries.source, 'EU')
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
					source: 'EU',
					entityName: entry.entityName,
					reason: 'EU Consolidated Sanctions List'
				});
			}
			upserted++;
		}

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'EU',
			status: 'success',
			recordsProcessed: upserted,
			flagsFound: 0,
			duration
		});

		return { count: upserted, duration };
	} catch (error) {
		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'EU',
			status: 'error',
			recordsProcessed: 0,
			flagsFound: 0,
			error: String(error),
			duration
		});
		// Don't throw — EU sync failing shouldn't block everything
		return { count: 0, duration };
	}
}
