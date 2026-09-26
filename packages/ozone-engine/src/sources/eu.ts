/**
 * EU Consolidated Financial Sanctions List (FSF). Addresses appear in
 * `<remark>` texts (e.g. Garantex, Grinex, A7A5 entities); each remark is
 * followed by a `<regulationSummary>` with the publishing regulation, which
 * gives the listing date and the EUR-Lex URL for provenance.
 *
 * The official endpoint with the public token is tried first, the
 * OpenSanctions mirror of the same source XML second.
 */
import { emptyResult, type ListEntry, type ParseResult } from '../types.js';
import { extractAddresses } from './extract.js';
import { decodeEntities, parseAttrs } from '../util/xml.js';

export const EU_FSF_URL =
	'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
export const EU_FSF_MIRROR_URL = 'https://data.opensanctions.org/datasets/latest/eu_fsf/source.xml';

export function parseEuFsfXml(xml: string): ParseResult {
	const res = emptyResult();
	const gen = /generationDate="([^"]+)"/.exec(xml.slice(0, 2000));
	res.version = gen?.[1];
	const byKey = new Map<string, ListEntry>();
	let i = 0;
	for (;;) {
		const start = xml.indexOf('<sanctionEntity', i);
		if (start < 0) break;
		const gt = xml.indexOf('>', start);
		const end = xml.indexOf('</sanctionEntity>', gt);
		if (gt < 0 || end < 0) break;
		i = end + 17;
		const inner = xml.slice(gt + 1, end);
		if (!/(0x[0-9a-fA-F]{40}|wallet|crypto|\bT[1-9A-HJ-NP-Za-km-z]{20,}|bc1)/i.test(inner)) continue;
		const attrs = parseAttrs(xml.slice(start + 15, gt));
		const nameMatch = /<nameAlias[^>]*wholeName="([^"]*)"[^>]*strong="true"/.exec(inner) ?? /<nameAlias[^>]*wholeName="([^"]*)"/.exec(inner);
		const entity = decodeEntities(nameMatch?.[1] ?? '').trim() || attrs.euReferenceNumber || 'EU listed entity';
		const reg = /<regulation\s([^>]*)>/.exec(inner);
		const regAttrs = reg ? parseAttrs(reg[1]) : {};
		const regUrl = /<publicationUrl>([^<]+)<\/publicationUrl>/.exec(inner)?.[1];
		// each remark (+ the regulationSummary that follows it)
		const remarkRe = /<remark>([\s\S]*?)<\/remark>\s*(<regulationSummary\s[^>]*\/?>)?/g;
		let m: RegExpExecArray | null;
		while ((m = remarkRe.exec(inner))) {
			const text = decodeEntities(m[1]);
			const found = extractAddresses(text);
			if (!found.length) continue;
			const summary = m[2] ? parseAttrs(m[2]) : {};
			const listedAt = summary.publicationDate || regAttrs.publicationDate || undefined;
			const refUrl = summary.publicationUrl || regUrl || 'https://www.sanctionsmap.eu/';
			for (const f of found) {
				const p = f.parsed;
				if (byKey.has(p.key)) continue;
				byKey.set(p.key, {
					source: 'eu_fsf',
					key: p.key,
					chain: p.chain,
					address: p.address,
					category: 'sanctions',
					risk: 'severe',
					code: 'EU_SANCTIONS',
					entity,
					text: `Listed on the EU consolidated sanctions list: ${entity}${attrs.euReferenceNumber ? ` (${attrs.euReferenceNumber})` : ''}`,
					refUrl,
					refId: `eu:${attrs.logicalId ?? attrs.euReferenceNumber ?? ''}`,
					...(listedAt ? { listedAt } : {}),
					meta: {
						euReferenceNumber: attrs.euReferenceNumber,
						regulation: summary.numberTitle ?? regAttrs.numberTitle,
						label: f.label,
						listed: f.raw,
						...(f.joined ? { joinedFragments: true } : {})
					}
				});
			}
		}
	}
	res.entries = [...byKey.values()];
	return res;
}
