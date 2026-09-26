/**
 * OFAC Specially Designated Nationals list — every "Digital Currency
 * Address - <TICKER>" identifier, all tickers (XBT, ETH, USDT (TRON / ETH /
 * Omni), TRX, LTC, BCH, DOGE, XRP, SOL, BNB, ARB, BSC, USDC, ETC, XMR, ZEC,
 * DASH, BSV, BTG, XVG, and any ticker OFAC adds later: the ticker is read
 * from the file, not from a hard-coded ID table).
 *
 * Source: the Sanctions List Service export of the classic SDN.XML (29 MB,
 * public, no key). Delistings are detected by the store: an address that
 * disappears from a complete, sane download is marked removed.
 */
import { parseListedAddress } from '../../../ozone-client/src/index.js';
import { emptyResult, type ListEntry, type ParseResult } from '../types.js';
import { allTexts, blocks, firstText } from '../util/xml.js';

export const OFAC_SDN_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';
export const OFAC_ENTITY_URL = (uid: string) => `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${uid}`;

const DCA_PREFIX = 'Digital Currency Address - ';

function mdyToIso(s?: string): string | undefined {
	const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
}

export interface OfacParseResult extends ParseResult {
	publishDate?: string;
	recordCount?: number;
	/** Digital-currency identifiers seen (before de-duplication). */
	identifiers: number;
}

export function parseOfacSdnXml(xml: string): OfacParseResult {
	const res: OfacParseResult = { ...emptyResult(), identifiers: 0 };
	const pub = firstText(xml, 'publshInformation') ?? '';
	res.publishDate = mdyToIso(firstText(pub, 'Publish_Date'));
	const rc = Number(firstText(pub, 'Record_Count'));
	if (Number.isFinite(rc)) res.recordCount = rc;
	res.version = res.publishDate;

	const byKey = new Map<string, ListEntry>();
	for (const entry of blocks(xml, 'sdnEntry')) {
		if (!entry.includes(DCA_PREFIX)) continue;
		const uid = firstText(entry, 'uid') ?? '';
		const last = firstText(entry, 'lastName') ?? '';
		// first-level firstName only (aka blocks come later in the entry)
		const head = entry.slice(0, entry.indexOf('<programList>') >= 0 ? entry.indexOf('<programList>') : 400);
		const first = firstText(head, 'firstName');
		const entity = [first, last].filter(Boolean).join(' ').trim() || 'Unknown SDN entry';
		const sdnType = firstText(entry, 'sdnType');
		const programs = allTexts(firstText(entry, 'programList') ?? '', 'program');
		for (const id of blocks(entry, 'id')) {
			const idType = firstText(id, 'idType') ?? '';
			if (!idType.startsWith(DCA_PREFIX)) continue;
			res.identifiers++;
			const ticker = idType.slice(DCA_PREFIX.length).trim();
			const raw = (firstText(id, 'idNumber') ?? '').trim();
			const parsed = parseListedAddress(raw, ticker);
			if (!parsed) {
				res.rejected.push({ raw, declared: ticker, context: `OFAC uid ${uid}` });
				continue;
			}
			const p = parsed.parsed;
			if (parsed.declaredMismatch) {
				res.notes.push(`OFAC uid ${uid}: ${ticker}-labelled ${raw} is a ${p.chain} address`);
			}
			const existing = byKey.get(p.key);
			if (existing) {
				const entities = (existing.meta?.entities as string[]) ?? [existing.entity ?? ''];
				if (!entities.includes(entity)) {
					entities.push(entity);
					existing.meta = { ...existing.meta, entities };
					existing.entity = entities.join(' / ');
					existing.text = `Listed on the OFAC SDN list: ${existing.entity}`;
				}
				const tickers = new Set([...(existing.meta?.tickers as string[]), ticker]);
				existing.meta = { ...existing.meta, tickers: [...tickers] };
				continue;
			}
			const progText = programs.length ? ` (program${programs.length > 1 ? 's' : ''} ${programs.join(', ')})` : '';
			byKey.set(p.key, {
				source: 'ofac_sdn',
				key: p.key,
				chain: p.chain,
				address: p.address,
				category: 'sanctions',
				risk: 'severe',
				code: 'OFAC_SDN',
				entity,
				text: `Listed on the OFAC SDN list: ${entity}${progText}`,
				refUrl: OFAC_ENTITY_URL(uid),
				refId: `sdn:${uid}`,
				meta: {
					programs,
					tickers: [ticker],
					sdnType,
					listed: raw,
					...(parsed.declaredMismatch ? { declaredMismatch: true } : {})
				}
			});
		}
	}
	res.entries = [...byKey.values()];
	return res;
}
