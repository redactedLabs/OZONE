import { XMLParser } from 'fast-xml-parser';
import { db } from '../db';
import { complianceEntries, syncLog } from '../db/schema';
import { eq } from 'drizzle-orm';

const OFAC_SDN_URL =
	'https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml';

// FeatureTypeID → chain mapping from the OFAC XML reference data
const FEATURE_TYPE_CHAINS: Record<string, string> = {
	'344': 'BTC',   // Digital Currency Address - XBT
	'345': 'ETH',   // Digital Currency Address - ETH
	'444': 'XMR',   // Digital Currency Address - XMR
	'566': 'LTC',   // Digital Currency Address - LTC
	'686': 'ZEC',   // Digital Currency Address - ZEC
	'687': 'DASH',  // Digital Currency Address - DASH
	'688': 'BTG',   // Digital Currency Address - BTG
	'689': 'ETC',   // Digital Currency Address - ETC
	'706': 'BSV',   // Digital Currency Address - BSV
	'726': 'BCH',   // Digital Currency Address - BCH
	'746': 'XVG',   // Digital Currency Address - XVG
	'887': 'USDT',  // Digital Currency Address - USDT
	'907': 'XRP',   // Digital Currency Address - XRP
	'992': 'TRX',   // Digital Currency Address - TRX
	'998': 'USDC',  // Digital Currency Address - USDC
	'1007': 'ARB',  // Digital Currency Address - ARB
	'1008': 'BSC',  // Digital Currency Address - BSC
	'1167': 'SOL',  // Digital Currency Address - SOL
};

const CRYPTO_FEATURE_TYPE_IDS = new Set(Object.keys(FEATURE_TYPE_CHAINS));

interface ParsedAddress {
	address: string;
	chain: string;
	identityId: string;
}

export async function syncOFAC(): Promise<{
	count: number;
	duration: number;
}> {
	const start = Date.now();

	try {
		const response = await fetch(OFAC_SDN_URL, { redirect: 'follow' });
		if (!response.ok) {
			throw new Error(`OFAC fetch failed: ${response.status}`);
		}

		const xml = await response.text();

		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
			textNodeName: '#text',
			parseTagValue: false,
			numberParseOptions: { hex: false, leadingZeros: false },
			isArray: (name) => {
				// Force arrays for elements that can appear multiple times
				return [
					'DistinctParty', 'Profile', 'Identity', 'Alias',
					'Feature', 'FeatureVersion', 'VersionDetail',
					'IdentityReference', 'DocumentedName', 'DocumentedNamePart',
					'NamePartValue'
				].includes(name);
			}
		});
		const data = parser.parse(xml);

		// Step 1: Build FeatureType lookup from reference data
		const featureTypes = data?.Sanctions?.ReferenceValueSets?.FeatureTypeValues?.FeatureType;
		const featureTypeMap = new Map<string, string>();
		if (featureTypes) {
			const ftList = Array.isArray(featureTypes) ? featureTypes : [featureTypes];
			for (const ft of ftList) {
				const id = String(ft?.['@_ID'] || '');
				if (CRYPTO_FEATURE_TYPE_IDS.has(id)) {
					featureTypeMap.set(id, FEATURE_TYPE_CHAINS[id]);
				}
			}
		}

		// Step 2: Build entity name lookup from DistinctParties
		const nameMap = new Map<string, string>();
		const parties = data?.Sanctions?.DistinctParties?.DistinctParty || [];
		const partyList = Array.isArray(parties) ? parties : [parties];

		for (const party of partyList) {
			const profiles = party?.Profile || [];
			const profileList = Array.isArray(profiles) ? profiles : [profiles];

			for (const profile of profileList) {
				const identities = profile?.Identity || [];
				const identityList = Array.isArray(identities) ? identities : [identities];

				for (const identity of identityList) {
					const identityId = String(identity?.['@_ID'] || profile?.['@_ID'] || '');
					// Try to get name from Alias
					const aliases = identity?.Alias || [];
					const aliasList = Array.isArray(aliases) ? aliases : [aliases];
					for (const alias of aliasList) {
						const docNames = alias?.DocumentedName || [];
						const docNameList = Array.isArray(docNames) ? docNames : [docNames];
						for (const docName of docNameList) {
							const parts = docName?.DocumentedNamePart || [];
							const partList = Array.isArray(parts) ? parts : [parts];
							const nameParts: string[] = [];
							for (const part of partList) {
								const npv = part?.NamePartValue;
								if (npv) {
									const vals = Array.isArray(npv) ? npv : [npv];
									for (const v of vals) {
										const text = typeof v === 'string' ? v : v?.['#text'] || '';
										if (text) nameParts.push(text);
									}
								}
							}
							if (nameParts.length > 0) {
								nameMap.set(identityId, nameParts.join(' '));
							}
						}
					}
				}

				// Also extract features (crypto addresses) from the profile
				const features = profile?.Feature || [];
				const featureList = Array.isArray(features) ? features : [features];

				for (const feature of featureList) {
					const featureTypeId = String(feature?.['@_FeatureTypeID'] || '');
					const chain = FEATURE_TYPE_CHAINS[featureTypeId];
					if (!chain) continue;

					const versions = feature?.FeatureVersion || [];
					const versionList = Array.isArray(versions) ? versions : [versions];

					for (const version of versionList) {
						const details = version?.VersionDetail || [];
						const detailList = Array.isArray(details) ? details : [details];

						for (const detail of detailList) {
							const addr = typeof detail === 'string'
								? detail
								: detail?.['#text'] || '';
							const addrStr = String(addr).trim();
							if (!addrStr || addrStr === '[object Object]') continue;

							// Get the identity reference for this feature
							const identityRefs = feature?.IdentityReference || [];
							const refList = Array.isArray(identityRefs) ? identityRefs : [identityRefs];
							const identityId = refList[0]?.['@_IdentityID'] || '';

							const normalizedAddr = (chain === 'ETH' || chain === 'USDT' || chain === 'USDC' || chain === 'ARB' || chain === 'BSC')
								? addrStr.toLowerCase()
								: addrStr;

							const entityName = nameMap.get(String(identityId)) || 'Unknown OFAC Entity';

							await db.insert(complianceEntries).values({
								address: normalizedAddr,
								chain,
								source: 'OFAC',
								entityName,
								reason: 'OFAC SDN List'
							}).onConflictDoUpdate({
								target: [complianceEntries.address, complianceEntries.source],
								set: {
									lastSeen: new Date(),
									entityName,
									chain
								}
							});
						}
					}
				}
			}
		}

		// Count total entries
		const [countResult] = await db
			.select({ count: eq(complianceEntries.source, 'OFAC') })
			.from(complianceEntries)
			.where(eq(complianceEntries.source, 'OFAC'));

		// Count what we just processed
		const allOFAC = await db
			.select()
			.from(complianceEntries)
			.where(eq(complianceEntries.source, 'OFAC'));

		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'OFAC',
			status: 'success',
			recordsProcessed: allOFAC.length,
			flagsFound: 0,
			duration
		});

		return { count: allOFAC.length, duration };
	} catch (error) {
		const duration = Date.now() - start;
		await db.insert(syncLog).values({
			type: 'OFAC',
			status: 'error',
			recordsProcessed: 0,
			flagsFound: 0,
			error: String(error),
			duration
		});
		throw error;
	}
}
