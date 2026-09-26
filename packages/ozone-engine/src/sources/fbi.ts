/**
 * Law-enforcement attributions published by the FBI (IC3 public service
 * announcements). The Bybit PSA (I-022625-PSA, 2025-02-26) lists the
 * Ethereum addresses TraderTraitor (DPRK) used to launder the $1.5B theft
 * and asks VASPs to block transactions "with or derived from" them — which
 * is exactly what Ozone's THORChain tracing does downstream.
 */
import { detectAddress } from '../../../ozone-client/src/index.js';
import { emptyResult, type ParseResult } from '../types.js';
import { stripTags } from '../util/xml.js';

export interface FbiPublication {
	id: string;
	url: string;
	date: string;
	title: string;
	entity: string;
	incident: string;
}

export const FBI_PUBLICATIONS: FbiPublication[] = [
	{
		id: 'I-022625-PSA',
		url: 'https://www.ic3.gov/PSA/2025/PSA250226',
		date: '2025-02-26',
		title: 'North Korea Responsible for $1.5 Billion Bybit Hack',
		entity: 'TraderTraitor (DPRK / Lazarus Group)',
		incident: 'Bybit hack (2025-02-21)'
	}
];

export function parseFbiPublication(html: string, pub: FbiPublication): ParseResult {
	const res = emptyResult();
	res.version = pub.id;
	const text = stripTags(html);
	const tokens = new Set(text.match(/\b0x[0-9a-fA-F]{40}\b|\b(?:bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|T[1-9A-HJ-NP-Za-km-z]{33})\b/g) ?? []);
	for (const raw of tokens) {
		const p = detectAddress(raw)[0];
		if (!p) {
			res.rejected.push({ raw, context: pub.id });
			continue;
		}
		res.entries.push({
			source: 'fbi',
			key: p.key,
			chain: p.chain,
			address: p.address,
			category: 'law_enforcement',
			risk: 'severe',
			code: 'FBI_DPRK',
			entity: pub.entity,
			text: `FBI ${pub.id} (${pub.date}): address operated by or closely connected to ${pub.entity} — ${pub.incident}`,
			refUrl: pub.url,
			refId: pub.id,
			listedAt: pub.date,
			meta: { title: pub.title, listed: raw }
		});
	}
	return res;
}
