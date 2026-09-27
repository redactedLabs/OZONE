/**
 * Every list Ozone ingests, with its fetch/parse function, provenance and
 * the sanity rules that protect against a partial download silently
 * "delisting" thousands of addresses.
 */
import { parseForChain } from '../../../ozone-client/src/index.js';
import { emptyResult, type Logger, type ParseResult, type Sql } from '../types.js';
import { manualEntries } from '../store/entries.js';
import { httpJson, httpText, type HttpOptions } from '../util/http.js';
import { ETH_LABELS_URL, parseEthLabels, parseScamSniffer, SCAMSNIFFER_URL } from './community.js';
import { CURATED } from './curated-data.js';
import { EU_FSF_MIRROR_URL, EU_FSF_URL, parseEuFsfXml } from './eu.js';
import { syncChainalysisOracle, syncCircle, syncTether } from './events.js';
import { FBI_PUBLICATIONS, parseFbiPublication } from './fbi.js';
import { OFAC_SDN_URL, parseOfacSdnXml } from './ofac.js';
import { parseUkSanctionsXml, UK_SANCTIONS_URL } from './uk.js';

export type SourceKind = 'sanctions' | 'law_enforcement' | 'stablecoin' | 'community' | 'curated' | 'derived' | 'manual';

export interface SourceContext {
	http?: HttpOptions;
	logger?: Logger;
	/** Database, for sources that live in it (maintainer flags). */
	sql?: Sql;
}

export interface SourceDef {
	id: string;
	name: string;
	kind: SourceKind;
	/** Human reference for the methodology page. */
	url: string;
	description: string;
	/** Default sync period. */
	intervalMs: number;
	/** Refuse a sync whose active count drops by more than this fraction (default 0.25). */
	maxDropRatio?: number;
	/** Refuse a sync with fewer entries than this. */
	minEntries?: number;
	fetchParse(ctx: SourceContext): Promise<ParseResult>;
}

const H = 3600_000;

async function firstOk<T>(urls: string[], fn: (url: string) => Promise<T>, logger?: Logger): Promise<T> {
	let last: unknown;
	for (const url of urls) {
		try {
			return await fn(url);
		} catch (e) {
			last = e;
			logger?.warn(`fetch failed for ${url.split('?')[0]}: ${(e as Error).message}`);
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}

export function parseCurated(): ParseResult {
	const res = emptyResult();
	res.version = CURATED.version;
	for (const inc of CURATED.incidents) {
		for (const a of inc.addresses) {
			const p = parseForChain(a.address, a.chain);
			if (!p) throw new Error(`curated incident ${inc.id}: invalid ${a.chain} address ${a.address}`);
			res.entries.push({
				source: 'curated',
				key: p.key,
				chain: p.chain,
				address: p.address,
				category: inc.category,
				risk: inc.risk,
				code: inc.code,
				entity: inc.entity,
				text: inc.text,
				refUrl: inc.ref,
				refId: inc.id,
				listedAt: inc.date,
				meta: { incident: inc.name, verification: inc.verification }
			});
		}
	}
	return res;
}

export const SOURCES: SourceDef[] = [
	{
		id: 'ofac_sdn',
		name: 'OFAC SDN list',
		kind: 'sanctions',
		url: 'https://sanctionssearch.ofac.treas.gov/',
		description:
			'US Treasury Specially Designated Nationals list — every "Digital Currency Address" identifier, all tickers. Addresses that disappear from a complete download are marked delisted.',
		intervalMs: 1 * H,
		minEntries: 500,
		maxDropRatio: 0.1,
		async fetchParse(ctx) {
			const xml = await httpText(OFAC_SDN_URL, { timeoutMs: 180_000, ...ctx.http });
			const res = parseOfacSdnXml(xml);
			if (!res.recordCount || res.recordCount < 5000) throw new Error('OFAC SDN download looks incomplete');
			return res;
		}
	},
	{
		id: 'uk_fcdo',
		name: 'UK Sanctions List (FCDO)',
		kind: 'sanctions',
		url: 'https://www.gov.uk/government/publications/the-uk-sanctions-list',
		description: 'UK Sanctions List; wallet addresses published in designation texts, checksum-validated.',
		intervalMs: 6 * H,
		minEntries: 20,
		maxDropRatio: 0.25,
		async fetchParse(ctx) {
			const xml = await httpText(UK_SANCTIONS_URL, { timeoutMs: 180_000, ...ctx.http });
			if (!xml.includes('<Designations')) throw new Error('UK list download looks incomplete');
			return parseUkSanctionsXml(xml);
		}
	},
	{
		id: 'eu_fsf',
		name: 'EU consolidated sanctions list',
		kind: 'sanctions',
		url: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
		description: 'EU Financial Sanctions Files; wallet addresses published in entity remarks, with the listing regulation as provenance.',
		intervalMs: 6 * H,
		minEntries: 5,
		maxDropRatio: 0.25,
		async fetchParse(ctx) {
			const xml = await firstOk(
				[EU_FSF_URL, EU_FSF_MIRROR_URL],
				(url) => httpText(url, { timeoutMs: 180_000, ...ctx.http }),
				ctx.logger
			);
			if (!xml.includes('<sanctionEntity')) throw new Error('EU list download looks incomplete');
			return parseEuFsfXml(xml);
		}
	},
	{
		id: 'chainalysis_oracle',
		name: 'Chainalysis sanctions oracle (on-chain)',
		kind: 'sanctions',
		url: 'https://etherscan.io/address/0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
		description:
			'Events of the public on-chain sanctions oracle (no API key): an independent machine-readable mirror of OFAC EVM designations, including delistings (e.g. Tornado Cash, 2025-03-21).',
		intervalMs: 1 * H,
		minEntries: 50,
		maxDropRatio: 0.25,
		fetchParse: (ctx) => syncChainalysisOracle({ ...ctx.http, logger: ctx.logger })
	},
	{
		id: 'fbi',
		name: 'FBI / IC3 attributions',
		kind: 'law_enforcement',
		url: 'https://www.ic3.gov/PSA',
		description: 'Addresses the FBI attributes to DPRK (TraderTraitor / Lazarus) laundering, e.g. the Bybit PSA I-022625-PSA.',
		intervalMs: 24 * H,
		minEntries: 10,
		async fetchParse(ctx) {
			const res = emptyResult();
			for (const pub of FBI_PUBLICATIONS) {
				const html = await httpText(pub.url, { timeoutMs: 60_000, ...ctx.http });
				const r = parseFbiPublication(html, pub);
				res.entries.push(...r.entries);
				res.rejected.push(...r.rejected);
			}
			res.version = FBI_PUBLICATIONS.map((p) => p.id).join(',');
			return res;
		}
	},
	{
		id: 'curated',
		name: 'Curated attributions',
		kind: 'curated',
		url: 'https://github.com/redactedLabs/OZONE/blob/main/packages/ozone-engine/src/sources/curated-data.ts',
		description: 'Individually verified attributions with a named primary source (e.g. FBI 2023-08-22 DPRK bitcoin addresses).',
		intervalMs: 24 * H,
		fetchParse: async () => parseCurated()
	},
	{
		id: 'tether',
		name: 'Tether USDT freezes',
		kind: 'stablecoin',
		url: 'https://tether.to/en/legal/',
		description: 'USDT blacklist events on Ethereum, TRON and Avalanche (freeze and unfreeze with block time and transaction).',
		intervalMs: 1 * H,
		minEntries: 1000,
		maxDropRatio: 0.1,
		fetchParse: (ctx) => syncTether({ ...ctx.http, logger: ctx.logger })
	},
	{
		id: 'circle',
		name: 'Circle USDC blacklist',
		kind: 'stablecoin',
		url: 'https://www.circle.com/legal/usdc-terms',
		description: 'USDC Blacklisted/UnBlacklisted events on Ethereum, Base and Avalanche.',
		intervalMs: 3 * H,
		minEntries: 100,
		maxDropRatio: 0.1,
		fetchParse: (ctx) => syncCircle({ ...ctx.http, logger: ctx.logger })
	},
	{
		id: 'manual',
		name: 'Ozone maintainers',
		kind: 'manual',
		url: 'https://ozone.redacted.gg/methodology#manual',
		description: 'Addresses flagged by an Ozone maintainer with a written reason (accepted reports included). Deactivating a flag delists it.',
		intervalMs: 5 * 60_000,
		maxDropRatio: 1,
		async fetchParse(ctx) {
			if (!ctx.sql) throw new Error('manual source needs the database');
			const res = emptyResult();
			res.entries = await manualEntries(ctx.sql);
			res.version = `flags:${res.entries.length}`;
			return res;
		}
	},
	{
		id: 'ethlabels',
		name: 'Labelled exploiters (eth-labels)',
		kind: 'community',
		url: 'https://github.com/dawsbot/eth-labels',
		description: 'Etherscan labels for exploiters, heist and phishing addresses (Bybit, WazirX, BingX, Radiant, …). OFAC/Tornado and victim ("compromised") labels are excluded.',
		intervalMs: 24 * H,
		minEntries: 200,
		maxDropRatio: 0.3,
		async fetchParse(ctx) {
			const json = await httpJson(ETH_LABELS_URL, { timeoutMs: 120_000, ...ctx.http });
			return parseEthLabels(json, `accounts:${Array.isArray(json) ? json.length : 0}`);
		}
	},
	{
		id: 'scamsniffer',
		name: 'ScamSniffer scam-database',
		kind: 'community',
		url: 'https://github.com/scamsniffer/scam-database',
		description: 'Phishing and wallet-drainer addresses (community list, published with a delay).',
		intervalMs: 6 * H,
		minEntries: 500,
		maxDropRatio: 0.3,
		async fetchParse(ctx) {
			const json = await httpJson(SCAMSNIFFER_URL, { timeoutMs: 60_000, ...ctx.http });
			return parseScamSniffer(json, `addresses:${Array.isArray(json) ? json.length : 0}`);
		}
	}
];

/**
 * The sources a snapshot cannot be signed without (buildAndStoreSnapshot's
 * completeness gate). This is every sanctions/law-enforcement/stablecoin
 * list plus the curated set — everything the product's "clean" verdicts and
 * certificates implicitly promise has actually been checked. Community
 * lists (ethlabels, scamsniffer) are deliberately excluded: useful signal,
 * not a claimed guarantee.
 */
export const CORE_SOURCES: readonly string[] = ['ofac_sdn', 'uk_fcdo', 'eu_fsf', 'fbi', 'curated', 'chainalysis_oracle', 'tether', 'circle'];

/** Sources that are not fetched lists but produced by Ozone itself. */
export const DERIVED_SOURCES = [
	{
		id: 'thorchain_trace',
		name: 'THORChain flow tracing',
		kind: 'derived' as const,
		url: 'https://ozone.redacted.gg/methodology#tracing',
		description: 'Addresses that received value from a listed address through THORChain (swaps incl. streaming and L1→L1, sends, LP withdrawals, THORNames).'
	},
	{
		id: 'cluster',
		name: 'Hack cluster expansion (Ethereum)',
		kind: 'derived' as const,
		url: 'https://ozone.redacted.gg/methodology#clusters',
		description: 'Addresses funded by a hack cluster within its laundering window (value threshold, hop limit, services excluded).'
	},
	{
		id: 'thorchain_links',
		name: 'Linked THORChain accounts',
		kind: 'derived' as const,
		url: 'https://ozone.redacted.gg/methodology#users',
		description: 'Monitored thor1 accounts whose Midgard history links them to a listed L1 address (one risk level lower; hubs and affiliate links ignored).'
	},
	{
		id: 'key_twin',
		name: 'Same-key addresses',
		kind: 'derived' as const,
		url: 'https://ozone.redacted.gg/methodology#twins',
		description: 'The TRON / EVM or BTC / BCH / LTC / DOGE address controlled by the same key as a listed address.'
	},
];

export function sourceById(id: string): SourceDef | undefined {
	return SOURCES.find((s) => s.id === id);
}
