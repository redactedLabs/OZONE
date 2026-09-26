/**
 * UK Sanctions List (FCDO) — the UK's single sanctions list since 2026.
 * Crypto addresses are published in free text ("OtherInformation",
 * statements of reasons): "Digital Currency Address: XBT 3Lpoy…",
 * "(1) ETH: 0x175d… (2) BNB: 0x175d…", "…the following crypto wallet
 * addresses: TJqUC… TVa1p…". They are extracted with checksum validation.
 */
import { emptyResult, type ListEntry, type ParseResult } from '../types.js';
import { extractAddresses } from './extract.js';
import { blocks, firstText } from '../util/xml.js';

export const UK_SANCTIONS_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml';
export const UK_REFERENCE_URL = 'https://www.gov.uk/government/publications/the-uk-sanctions-list';

function dmyToIso(s?: string): string | undefined {
	const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
	return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

export function parseUkSanctionsXml(xml: string): ParseResult {
	const res = emptyResult();
	res.version = dmyToIso(firstText(xml.slice(0, 2000), 'DateGenerated'));
	const byKey = new Map<string, ListEntry>();
	for (const d of blocks(xml, 'Designation')) {
		const text = [firstText(d, 'OtherInformation'), firstText(d, 'UKStatementofReasons')].filter(Boolean).join(' \n ');
		if (!text || !/(0x[0-9a-fA-F]{40}|wallet|currency|crypto|\bT[1-9A-HJ-NP-Za-km-z]{20,}|bc1)/i.test(text)) continue;
		const found = extractAddresses(text);
		if (!found.length) continue;
		const uid = firstText(d, 'UniqueID') ?? '';
		let entity: string | undefined;
		for (const n of blocks(d, 'Name')) {
			if ((firstText(n, 'NameType') ?? '').toLowerCase() === 'primary name') {
				entity = [firstText(n, 'Name1'), firstText(n, 'Name2'), firstText(n, 'Name3'), firstText(n, 'Name4'), firstText(n, 'Name5'), firstText(n, 'Name6')]
					.filter(Boolean)
					.join(' ')
					.trim();
				break;
			}
		}
		entity ||= firstText(d, 'Name6') ?? uid;
		const regime = firstText(d, 'RegimeName');
		const listedAt = dmyToIso(firstText(d, 'DateDesignated'));
		for (const f of found) {
			const p = f.parsed;
			if (byKey.has(p.key)) continue;
			byKey.set(p.key, {
				source: 'uk_fcdo',
				key: p.key,
				chain: p.chain,
				address: p.address,
				category: 'sanctions',
				risk: 'severe',
				code: 'UK_SANCTIONS',
				entity,
				text: `Listed on the UK Sanctions List: ${entity}${regime ? ` (${regime})` : ''}`,
				refUrl: UK_REFERENCE_URL,
				refId: `uk:${uid}`,
				...(listedAt ? { listedAt } : {}),
				meta: { regime, label: f.label, listed: f.raw, ...(f.joined ? { joinedFragments: true } : {}) }
			});
		}
	}
	res.entries = [...byKey.values()];
	return res;
}
