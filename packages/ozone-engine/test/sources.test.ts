import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEthLabels, parseScamSniffer } from '../src/sources/community.js';
import { parseEuFsfXml } from '../src/sources/eu.js';
import { extractAddresses } from '../src/sources/extract.js';
import { FBI_PUBLICATIONS, parseFbiPublication } from '../src/sources/fbi.js';
import { parseOfacSdnXml } from '../src/sources/ofac.js';
import { parseCurated } from '../src/sources/registry.js';
import { parseUkSanctionsXml } from '../src/sources/uk.js';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('OFAC SDN (real excerpt of the 2026-09-23 list)', () => {
	const res = parseOfacSdnXml(fx('ofac-sdn-excerpt.xml'));
	const byKey = new Map(res.entries.map((e) => [e.key, e]));

	it('reads the publication header', () => {
		expect(res.publishDate).toBe('2026-09-23');
		expect(res.recordCount).toBe(19391);
	});

	it('imports Lazarus Group ETH addresses with provenance', () => {
		const ronin = byKey.get('evm:0x098b716b8aaf21512996dc57eb0615e2383e2f96')!;
		expect(ronin.entity).toBe('LAZARUS GROUP');
		expect(ronin.category).toBe('sanctions');
		expect(ronin.risk).toBe('severe');
		expect(ronin.refUrl).toBe('https://sanctionssearch.ofac.treas.gov/Details.aspx?id=27307');
		expect(ronin.meta?.programs).toEqual(['DPRK3']);
		expect(ronin.text).toContain('DPRK3');
	});

	it('reads every ticker, detects the real chain and notes mislabels', () => {
		const chains = new Set(res.entries.map((e) => e.chain));
		for (const c of ['ETH', 'TRON', 'BCH', 'BNB', 'DOGE', 'XRP', 'SOL', 'BTC']) expect(chains).toContain(c);
		// XBT-labelled TRON address (uid 45404)
		expect(byKey.get('tron:TUCsTq7TofTCJRRoHk6RvhMoS2mJLm5Yzq')?.meta?.declaredMismatch).toBe(true);
		expect(res.notes.join(' ')).toContain('XBT-labelled TUCsTq7TofTCJRRoHk6RvhMoS2mJLm5Yzq is a TRON address');
		// BCH is stored in THORChain's cashaddr form
		expect(res.entries.filter((e) => e.chain === 'BCH').every((e) => /^[qp]/.test(e.address))).toBe(true);
		// USDT on Omni is a bitcoin address
		const omni = res.entries.find((e) => (e.meta?.tickers as string[]).includes('USDT') && e.chain === 'BTC');
		expect(omni).toBeDefined();
	});

	it('rejects identifiers that are not addresses instead of importing garbage', () => {
		expect(res.rejected.map((r) => r.raw)).toContain('5be5543ff73456ab9f2d207887e2af87322c651ea1a873c5b25b7ffae456c320');
		expect(res.entries.every((e) => e.key.includes(':'))).toBe(true);
	});
});

describe('UK Sanctions List (FCDO)', () => {
	const res = parseUkSanctionsXml(fx('uk-excerpt.xml'));
	it('extracts labelled and unlabelled wallet addresses from free text', () => {
		const keys = res.entries.map((e) => e.key);
		expect(keys).toContain('evm:0x175d44451403edf28469df03a9280c1197adb92c'); // "(1) ETH: 0x175d…"
		expect(keys).toContain('tron:TJqUC56SDZ373JYRurzXtMcor2HQvN9BaU'); // EXMO, unlabelled list
		expect(keys).toContain('btc:3Lpoy53K625zVeE47ZasiG5jGkAxJ27kh1'); // "Digital Currency Address: XBT 3Lpoy…"
		const exmo = res.entries.find((e) => e.address === 'TJqUC56SDZ373JYRurzXtMcor2HQvN9BaU')!;
		expect(exmo.entity).toBe('EXMO EXCHANGE LIMITED');
		expect(exmo.listedAt).toBe('2026-05-26');
		expect(exmo.category).toBe('sanctions');
	});
});

describe('EU consolidated list', () => {
	const res = parseEuFsfXml(fx('eu-excerpt.xml'));
	it('extracts Garantex and Grinex addresses with the listing regulation', () => {
		const garantexEth = res.entries.find((e) => e.key === 'evm:0x002471b8a185f9980708d0eaec5b289714f56f8d')!;
		expect(garantexEth.entity).toBe('Garantex');
		expect(garantexEth.refUrl).toMatch(/^https:\/\/eur-lex\.europa\.eu\//);
		expect(garantexEth.listedAt).toBe('2025-02-24');
	});
	it('re-joins an address the official text split with a space', () => {
		const joined = res.entries.find((e) => e.address === 'TNZxGWCwvsHr6JxQxzoeDXV597Yf7Zb7nV');
		expect(joined?.meta?.joinedFragments).toBe(true);
		expect(joined?.entity).toBe('Grinex');
	});
});

describe('FBI Bybit PSA', () => {
	it('imports the 51 published Ethereum addresses', () => {
		const res = parseFbiPublication(fx('fbi-psa250226.html'), FBI_PUBLICATIONS[0]);
		expect(res.entries).toHaveLength(51);
		expect(res.entries.every((e) => e.chain === 'ETH' && e.category === 'law_enforcement' && e.risk === 'severe')).toBe(true);
		expect(res.entries.map((e) => e.key)).toContain('evm:0x51e9d833ecae4e8d9d8be17300aee6d3398c135d');
		expect(res.entries[0].refUrl).toBe('https://www.ic3.gov/PSA/2025/PSA250226');
		expect(res.entries[0].listedAt).toBe('2025-02-26');
	});
});

describe('community lists', () => {
	it('eth-labels: imports attackers, excludes stale OFAC/Tornado labels and victims', () => {
		const res = parseEthLabels(JSON.parse(fx('ethlabels-excerpt.json')));
		const labels = new Set(res.entries.map((e) => e.meta?.label));
		for (const bad of ['ofac-sanctioned', 'ofac-sanctions-lists', 'tornado-cash', 'cpimp-attack', 'blocked', 'exchange']) {
			expect(labels.has(bad)).toBe(false);
		}
		const bybit = res.entries.find((e) => e.key === 'evm:0xb21e59b3d4e4d6c5247325dc5fbedbc89afc69f4')!;
		expect(bybit.category).toBe('hack');
		expect(bybit.entity).toBe('Bybit Exploiter 65');
		// a phishing address mislabelled under bybit-exploit is treated as phishing
		expect(res.entries.find((e) => e.key === 'evm:0x363908df2b0890e7e5c1e403935133094287d7d1')?.category).toBe('phishing');
		expect(res.notes.join(' ')).toMatch(/skipped \d+ entries labelled cpimp-attack/);
	});

	it('ScamSniffer: validates every address', () => {
		const res = parseScamSniffer(JSON.parse(fx('scamsniffer-excerpt.json')));
		expect(res.entries).toHaveLength(25);
		expect(res.rejected).toHaveLength(1);
		expect(res.entries[0].category).toBe('phishing');
		expect(res.entries[0].risk).toBe('medium');
	});

	it('curated attributions are all valid and carry a primary source', () => {
		const res = parseCurated();
		expect(res.entries.length).toBeGreaterThanOrEqual(7);
		expect(res.entries.every((e) => e.refUrl?.startsWith('https://'))).toBe(true);
		expect(res.entries.map((e) => e.key)).toContain('btc:3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG');
	});
});

describe('free-text extraction', () => {
	it('never imports unlabelled checksum-less base58 (Solana/Monero-like identifiers)', () => {
		const text = 'Legal Entity Identifier - 4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T registration';
		expect(extractAddresses(text)).toEqual([]);
		const labelled = extractAddresses('SOL: 4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T');
		expect(labelled.map((x) => x.parsed.chain)).toEqual(['SOL']);
	});
	it('handles glued labels, punctuation and BNB-as-BSC', () => {
		const found = extractAddresses('(2) BNB:0x175d44451403Edf28469dF03A9280c1197ADb92c; USDT: TGJVc32ig2u8tQsYMLE7KXHT5NDQroaVNU.');
		expect(found.map((f) => [f.parsed.chain, f.label])).toEqual([
			['BSC', 'BNB'],
			['TRON', 'USDT']
		]);
	});
	it('does not join fragments into something that fails a checksum', () => {
		expect(extractAddresses('TNZxGWCwvsHr6JxQxzoeDXV5 97Yf7Zb7nX')).toEqual([]);
	});
});
