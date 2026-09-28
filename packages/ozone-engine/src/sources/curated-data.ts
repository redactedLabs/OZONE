/**
 * Curated, individually verified attributions that no machine-readable
 * source publishes: hack and exploit incidents with the addresses public
 * sources name as the attacker's, law-enforcement lists published only as
 * web pages (e.g. fbi.gov, which blocks automated fetches), and the hack
 * clusters Ozone expands on-chain.
 *
 * Contributing: every address needs its own public source in `ref` (the
 * page that names that address), a source type and a confidence:
 * - `high` (published as risk "severe"): law enforcement (FBI/IC3, DOJ,
 *   police), sanctions designations, or the victim's own statement or
 *   post-mortem;
 * - `medium` (risk "high"): an established investigator's public post
 *   (ZachXBT, SlowMist/MistTrack, Elliptic, TRM Labs, Chainalysis,
 *   PeckShield, CertiK, BlockSec, Cyvers, Beosin, Hacken, Halborn,
 *   Merkle Science, rekt.news, …).
 * Addresses are validated at import (checksums, EIP-55 for mixed-case EVM
 * addresses); an invalid one fails the sync loudly. Never add service
 * addresses (exchanges, bridges, routers, THORChain vaults, mixers) or the
 * victim's own wallets. To delist an address keep it and set `delisted`
 * (history, with the reason); removing an incident delists all of it.
 */
import type { Category, Risk } from '../../../ozone-client/src/index.js';

/** What the address did in the incident. */
export type IncidentRole = 'exploiter' | 'laundering' | 'cashout';
/** high = primary source (law enforcement, sanctions, victim); medium = established investigator. */
export type Confidence = 'high' | 'medium';
export type RefType = 'law_enforcement' | 'sanctions' | 'victim' | 'investigator';

export interface IncidentAddress {
	chain: string;
	address: string;
	role: IncidentRole;
	/** Public page that names this address. */
	ref: string;
	refType: RefType;
	confidence: Confidence;
	note?: string;
	/** No longer attributed (misattribution, returned funds, …): published as history only. */
	delisted?: { date: string; reason: string };
}

/** Parameters of an on-chain fan-out (native units of the chain). */
export interface ExpansionParams {
	/** Smallest transfer followed. */
	minValue: number;
	/** Hops from the attributed addresses. */
	maxDepth: number;
	maxAddresses: number;
	/** Explorer requests one run may spend on this cluster (more are resumed in the next run). */
	maxRequests: number;
	/** An address with at least this many outgoing transactions in the window is a service. */
	serviceTxThreshold: number;
}

export interface CuratedIncident {
	id: string;
	name: string;
	/** Day of the theft (YYYY-MM-DD). */
	date: string;
	category: Category;
	/** Reason code for all its addresses (default by role: INCIDENT_EXPLOITER, …). */
	code?: string;
	/** Who did it according to the sources, or "unknown". */
	attribution: string;
	/** Main public source for the incident. */
	ref: string;
	/** How the addresses were checked. */
	verification: string;
	lossUsd?: number;
	/** Reported laundering through THORChain. */
	thorchain: { used: 'yes' | 'no' | 'unknown'; ref?: string; note?: string };
	/** Laundering window for the cluster expansion (default: the theft date + 180 days). */
	window?: { from: string; to: string };
	/** Cluster expansion: false = none (e.g. funds returned); otherwise per-chain overrides. */
	expand?: false | { chains?: string[]; params?: Partial<ExpansionParams> };
	addresses: IncidentAddress[];
}

export interface ClusterSpec extends ExpansionParams {
	id: string;
	/** The incident whose laundering this cluster is. */
	incident: string;
	name: string;
	chain: string;
	entity: string;
	ref: string;
	/** Seed addresses (the incident's own). */
	seeds?: string[];
	/** Sources whose addresses also seed the expansion. */
	seedSources?: string[];
	/** Only seeds whose entity contains this text (for broad sources such as eth-labels). */
	seedLabelFilter?: string;
	window: { from: string; to: string };
	risk: Risk;
	/** Members are traced first (a maintainer incident inside its urgent window). */
	urgent?: boolean;
	/** Lower runs first (THORChain-laundered incidents before others). */
	priority?: number;
}

/** An incident that was researched but has no usable public address list. */
export interface SearchedIncident {
	name: string;
	date: string;
	why: string;
}

export interface CuratedData {
	version: string;
	policy: string;
	incidents: CuratedIncident[];
	searched: SearchedIncident[];
	clusters: ClusterSpec[];
}

export const CURATED: CuratedData = {
	version: '2026-09-28',
	policy:
		'Only addresses that a public source names as the attacker\'s are admitted, each with the page that names it. Confidence high (published as risk severe): law enforcement, sanctions designations, or the victim itself. Confidence medium (published as risk high): established investigators\' public posts (ZachXBT, SlowMist/MistTrack, Elliptic, TRM Labs, Chainalysis, PeckShield, CertiK, BlockSec, Cyvers, Beosin, Hacken, Halborn, Merkle Science, Match Systems, BitOK, QuillAudits, rekt.news), also when quoted by news media. Every address was checked in September 2026: valid for its chain (checksums, EIP-55) and present verbatim on the cited page. Service addresses (exchanges, bridges, routers, THORChain vaults, mixers) and the victims\' own wallets are excluded. Incidents whose funds were returned are kept as history (delisted), never flagged. Sites whose terms forbid automated access (Etherscan, Arkham, X) were not fetched; their posts are cited only through pages that quote them. The previous hard-coded hack list was dropped in September 2026: of its 21 addresses only 4 could be confirmed.',
	incidents: [
		{
			id: 'humanity-2026',
			name: 'Humanity Protocol hack (2026-06-08)',
			date: '2026-06-08',
			category: 'hack',
			attribution: 'unknown (malware-based key theft)',
			ref: 'https://www.humanity.org/hincidentupdate',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (humanity.org). The team member\'s stolen signer key named on the same page is the victim\'s account and is left out.',
			lossUsd: 36_000_000,
			thorchain: { used: 'no', ref: 'https://www.humanity.org/hincidentupdate', note: 'stolen tokens sold on Uniswap and PancakeSwap' },
			addresses: [
				{ chain: 'ETH', address: '0xd1ea823d421e0c829ee11f772af487fd352678ea', role: 'laundering', ref: 'https://www.humanity.org/hincidentupdate', refType: 'victim', confidence: 'high', note: 'Destination the official post says ~141.18M $H was moved to on Ethereum.' },
				{ chain: 'BSC', address: '0x6Aa22CB8420E94Fc2119364b4c7885710aE753bB', role: 'exploiter', ref: 'https://www.humanity.org/hincidentupdate', refType: 'victim', confidence: 'high', note: 'New address to which ~100M newly-minted $H was sent on the BSC side of the attack, per the official incident update.' }
			]
		},
		{
			id: 'verus-bridge-2026',
			name: 'Verus-Ethereum bridge exploit (2026-05-18)',
			date: '2026-05-18',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://coincentral.com/verus-ethereum-bridge-exploit-drains-11-6m-as-attackers-swap-funds-to-eth/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (coincentral.com).',
			lossUsd: 11_600_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x5aBb91B9c01A5Ed3aE762d32B236595B459D5777', role: 'exploiter', ref: 'https://coincentral.com/verus-ethereum-bridge-exploit-drains-11-6m-as-attackers-swap-funds-to-eth/', refType: 'investigator', confidence: 'medium', note: 'attacker EOA, per PeckShield/Blockaid as quoted' },
				{ chain: 'ETH', address: '0x65Cb8b128Bf6e690761044CCECA422bb239C25F9', role: 'laundering', ref: 'https://coincentral.com/verus-ethereum-bridge-exploit-drains-11-6m-as-attackers-swap-funds-to-eth/', refType: 'investigator', confidence: 'medium', note: 'drainer wallet holding the swapped ETH' }
			]
		},
		{
			id: 'thorchain-vault-2026',
			name: 'THORChain vault exploit by a malicious validator (2026-05-15)',
			date: '2026-05-15',
			category: 'hack',
			attribution: 'unknown (a newly churned node exploited a TSS key-leakage bug)',
			ref: 'https://blog.thorchain.org/thorchain-exploit-report-1',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (blog.thorchain.org).',
			lossUsd: 10_700_000,
			thorchain: { used: 'unknown', note: 'THORChain itself was the victim' },
			addresses: [
				{ chain: 'THOR', address: 'thor16ucjv3v695mq283me7esh0wdhajjalengcn84q', role: 'exploiter', ref: 'https://blog.thorchain.org/thorchain-exploit-report-1', refType: 'victim', confidence: 'high', note: 'Identified in THORChain\'s own exploit post-mortem as the malicious newly-churned validator node that was the attack\'s entry point; this…' }
			]
		},
		{
			id: 'kelpdao-2026',
			name: 'KelpDAO rsETH bridge exploit (2026-04-18)',
			date: '2026-04-18',
			category: 'exploit',
			attribution: 'TraderTraitor (DPRK) per investigators (Mandiant, CrowdStrike, Elliptic; reported by rekt.news)',
			ref: 'https://rekt.news/kelpdao-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 292_000_000,
			thorchain: { used: 'yes', ref: 'https://rekt.news/kelpdao-rekt', note: 'about 75,700 ETH converted to BTC within 36 hours, primarily through THORChain' },
			addresses: [
				{ chain: 'ETH', address: '0x8B1b6c9A6DB1304000412dd21Ae6A70a82d60D3b', role: 'exploiter', ref: 'https://rekt.news/kelpdao-rekt', refType: 'investigator', confidence: 'medium', note: 'Recipient of the forged LayerZero packet (116,500 rsETH); listed first under \'Attacker Addresses\', citing ZachXBT/Cyvers/CertiK.' },
				{ chain: 'ETH', address: '0x5d3919F12bCc35c26Eee5F8226A9bee90c257Ccc', role: 'exploiter', ref: 'https://rekt.news/kelpdao-rekt', refType: 'investigator', confidence: 'medium', note: 'Listed under \'Attacker Addresses\' per ZachXBT/Cyvers/CertiK.' },
				{ chain: 'ETH', address: '0xCBb24A6B4DAfaAA1a759A2F413eA0eB6AE1455CC', role: 'exploiter', ref: 'https://rekt.news/kelpdao-rekt', refType: 'investigator', confidence: 'medium', note: 'Listed under \'Attacker Addresses\' per ZachXBT/Cyvers/CertiK.' },
				{ chain: 'ETH', address: '0x1F4C1c2e610f089D6914c4448E6F21Cb0db3adeF', role: 'exploiter', ref: 'https://rekt.news/kelpdao-rekt', refType: 'investigator', confidence: 'medium', note: '\'Largest single branch\' wallet, received 53,000 rsETH and opened an Aave V3 position.' }
			]
		},
		{
			id: 'drift-2026',
			name: 'Drift Protocol exploit (2026-04-01)',
			date: '2026-04-01',
			category: 'exploit',
			attribution: 'DPRK-linked (UNC4736) per Drift\'s post-mortem, TRM Labs and Elliptic',
			ref: 'https://financefeeds.com/drifts-285m-hacker-breaks-silence-with-a-big-move/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (financefeeds.com).',
			lossUsd: 285_000_000,
			thorchain: { used: 'no', ref: 'https://financefeeds.com/drifts-285m-hacker-breaks-silence-with-a-big-move/', note: 'moved through Tornado Cash' },
			addresses: [
				{ chain: 'ETH', address: '0xbDdAE987FEe930910fCC5aa403D5688fB440561B', role: 'exploiter', ref: 'https://financefeeds.com/drifts-285m-hacker-breaks-silence-with-a-big-move/', refType: 'investigator', confidence: 'medium', note: 'Labeled \'Drift Exploiter 4\' on Etherscan; moved 23,095.1 ETH (~$44.4M) to Tornado Cash in July 2026 per PeckShield, plus a small…' }
			]
		},
		{
			id: 'kraken-user-theft-2026-03',
			name: 'Kraken-user social-engineering theft (2026-03-31)',
			date: '2026-03-31',
			category: 'hack',
			attribution: 'unknown (social engineering; reported by ZachXBT)',
			ref: 'https://telegram.me/s/investigations?before=318',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (telegram.me).',
			lossUsd: 18_200_000,
			thorchain: { used: 'yes', ref: 'https://telegram.me/s/investigations?before=318', note: 'ETH bridged to Bitcoin through THORChain within an hour, per ZachXBT' },
			addresses: [
				{ chain: 'ETH', address: '0xC55149BbD560435a9FbEabFdcF9711cf928acA21', role: 'exploiter', ref: 'https://telegram.me/s/investigations?before=318', refType: 'investigator', confidence: 'medium', note: 'ZachXBT\'s public Telegram channel (Investigations by ZachXBT), \'Theft address\'.' },
				{ chain: 'BTC', address: '1D8f8956EEFLXN28AHfioEx4ywVbxCz8KN', role: 'cashout', ref: 'https://telegram.me/s/investigations?before=318', refType: 'investigator', confidence: 'medium', note: 'Posted immediately after the ETH theft address in the same ZachXBT message, as the THORChain BTC destination.' }
			]
		},
		{
			id: 'hw-wallet-theft-2026-01',
			name: 'Hardware-wallet social-engineering theft, $282M BTC and LTC (2026-01-10)',
			date: '2026-01-10',
			category: 'hack',
			attribution: 'unknown (social engineering; reported by ZachXBT)',
			ref: 'https://bitrss.com/crypto-scam-alert-whale-lost-over-282m-in-bitcoin-and-litecoin-via-social-engineering-scam-173859',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (bitrss.com, blockchain.news).',
			lossUsd: 282_000_000,
			thorchain: { used: 'yes', ref: 'https://blockchain.news/flashnews/282m-btc-and-ltc-drained-in-hardware-wallet-scam-attacker-swaps-818-btc-via-thorchain-into-eth-xrp-ltc', note: '818 BTC swapped through THORChain into ETH, XRP and LTC' },
			addresses: [
				{ chain: 'BTC', address: 'bc1qluxw46r55wf3dnk9c652vrt4duadm3hpuktf86', role: 'exploiter', ref: 'https://bitrss.com/crypto-scam-alert-whale-lost-over-282m-in-bitcoin-and-litecoin-via-social-engineering-scam-173859', refType: 'investigator', confidence: 'medium', note: 'One of \'three main wallet addresses\' ZachXBT identified as directly receiving the stolen 1,459 BTC / 2.05M LTC.' },
				{ chain: 'BTC', address: 'bc1qpsmh26ja0fzzf286zulmt9eywujc2pggj40wzm', role: 'exploiter', ref: 'https://bitrss.com/crypto-scam-alert-whale-lost-over-282m-in-bitcoin-and-litecoin-via-social-engineering-scam-173859', refType: 'investigator', confidence: 'medium', note: 'One of ZachXBT\'s three main theft addresses.' },
				{ chain: 'LTC', address: 'ltc1qly43c2prj4c2e85dcspzpjd36jnapnenldnr70', role: 'exploiter', ref: 'https://bitrss.com/crypto-scam-alert-whale-lost-over-282m-in-bitcoin-and-litecoin-via-social-engineering-scam-173859', refType: 'investigator', confidence: 'medium', note: 'The one Litecoin address among ZachXBT\'s three main theft addresses.' },
				{ chain: 'BTC', address: 'bc1qgkjems88jyk8hasj9ncspxz093nepdn00vaq0y', role: 'cashout', ref: 'https://blockchain.news/flashnews/282m-btc-and-ltc-drained-in-hardware-wallet-scam-attacker-swaps-818-btc-via-thorchain-into-eth-xrp-ltc', refType: 'investigator', confidence: 'medium', note: 'Named alongside the THORChain BTC->ETH/XRP/LTC swap description.' }
			]
		},
		{
			id: 'truebit-2026',
			name: 'Truebit exploit (2026-01-08)',
			date: '2026-01-08',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.panewslab.com/en/articles/b47adb56-1736-44b1-92cd-b8077327bc4a',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (panewslab.com).',
			lossUsd: 26_600_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x6c8ec8f14be7c01672d31cfa5f2cefeab2562b50', role: 'exploiter', ref: 'https://www.panewslab.com/en/articles/b47adb56-1736-44b1-92cd-b8077327bc4a', refType: 'investigator', confidence: 'medium', note: '"The address from which the attacker launched the attack", per PANews citing BeosinTrace; still held 267.71 ETH at report time.' },
				{ chain: 'ETH', address: '0xd12f6e0fa7fbf4e3a1c7996e3f0dd26ab9031a60', role: 'laundering', ref: 'https://www.panewslab.com/en/articles/b47adb56-1736-44b1-92cd-b8077327bc4a', refType: 'investigator', confidence: 'medium', note: 'Held 4,267.09 ETH of the stolen funds per PANews/BeosinTrace.' },
				{ chain: 'ETH', address: '0x273589ca3713e7becf42069f9fb3f0c164ce850a', role: 'laundering', ref: 'https://www.panewslab.com/en/articles/b47adb56-1736-44b1-92cd-b8077327bc4a', refType: 'investigator', confidence: 'medium', note: 'Held 4,001 ETH of the stolen funds per PANews/BeosinTrace.' }
			]
		},
		{
			id: 'yearn-yeth-2025',
			name: 'Yearn yETH exploit (2025-11-30)',
			date: '2025-11-30',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://rekt.news/yearn-rekt3',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 9_000_000,
			thorchain: { used: 'no', ref: 'https://rekt.news/yearn-rekt3', note: 'laundered through Tornado Cash' },
			addresses: [
				{ chain: 'ETH', address: '0xa80D3F2022F6Bfd0B260bF16D72CaD025440C822', role: 'exploiter', ref: 'https://rekt.news/yearn-rekt3', refType: 'investigator', confidence: 'medium', note: 'rekt.news: primary attacker address' },
				{ chain: 'ETH', address: '0xFb63aa935Cf0a003335dCE9Cca03c4F9c0fa4779', role: 'exploiter', ref: 'https://rekt.news/yearn-rekt3', refType: 'investigator', confidence: 'medium', note: 'rekt.news: secondary attacker address' }
			]
		},
		{
			id: 'balancer-2025',
			name: 'Balancer V2 exploit (2025-11-03)',
			date: '2025-11-03',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://research.blockscope.co/balancer-exploit',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (research.blockscope.co).',
			lossUsd: 128_000_000,
			thorchain: { used: 'yes', ref: 'https://news.bitcoin.com/balancer-exploiter-resurfaces-thorchain-eth-btc/', note: 'about 7,000 ETH swapped to 204.7 BTC through THORChain after five dormant months' },
			window: { from: '2025-11-02T00:00:00Z', to: '2026-09-30T00:00:00Z' },
			addresses: [
				{ chain: 'ETH', address: '0x86fedad11c4765700934639f1efe1fc01355c982', role: 'exploiter', ref: 'https://research.blockscope.co/balancer-exploit', refType: 'investigator', confidence: 'medium', note: 'Primary attacker EOA; received initial funding from Tornado Cash on Nov 2, 2025.' },
				{ chain: 'ETH', address: '0x766a892f8ba102556c8537d02fca0ff4cacfc492', role: 'laundering', ref: 'https://research.blockscope.co/balancer-exploit', refType: 'investigator', confidence: 'medium', note: 'Intermediary/staging EOA seeded with ETH to coordinate multi-chain bridging and funding distribution.' },
				{ chain: 'ARB', address: '0x506d1f9efe24f0d47853adca907eb8d89ae03207', role: 'exploiter', ref: 'https://research.blockscope.co/balancer-exploit', refType: 'investigator', confidence: 'medium', note: 'Attack contract deployer/executor address on Arbitrum that ran the EXACT_OUT rounding-bias sequence.' },
				{ chain: 'ARB', address: '0x872757006b6f2fd65244c0a2a5fdd1f70a7780f4', role: 'laundering', ref: 'https://research.blockscope.co/balancer-exploit', refType: 'investigator', confidence: 'medium', note: 'Proceeds-consolidation address on Arbitrum; later transferred ~1,830 ETH back to Ethereum.' }
			]
		},
		{
			id: 'sbi-crypto-2025',
			name: 'SBI Crypto mining-pool theft (2025-09-24)',
			date: '2025-09-24',
			category: 'hack',
			attribution: 'suspected DPRK per investigators (unconfirmed)',
			ref: 'https://rekt.news/sbi-crypto-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 21_000_000,
			thorchain: { used: 'no', ref: 'https://rekt.news/sbi-crypto-rekt', note: 'laundered through Tornado Cash, SideShift and OpenOcean' },
			addresses: [
				{ chain: 'ETH', address: '0x40d76a78ddba2ea81fb0f9fba147a08bcfc2b866', role: 'exploiter', ref: 'https://rekt.news/sbi-crypto-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: "Attacker\'s Wallet on Ethereum".' },
				{ chain: 'BTC', address: 'bc1qx0a2kfjd7eweczv8xqjm6rggm40v0nkhfss78l', role: 'exploiter', ref: 'https://rekt.news/sbi-crypto-rekt', refType: 'investigator', confidence: 'medium', note: 'Listed by rekt.news among the \'theft addresses\' (Bitcoin).' },
				{ chain: 'BCH', address: 'qpv9nh5ktagsmtkqle8z2w4dd3mksskpmy499z7c9k', role: 'exploiter', ref: 'https://rekt.news/sbi-crypto-rekt', refType: 'investigator', confidence: 'medium', note: 'Listed by rekt.news among the \'theft addresses\' (Bitcoin Cash).' },
				{ chain: 'LTC', address: 'ltc1qjyrn9p803efj3p8a0g3fmlevs45kq704ns363t', role: 'exploiter', ref: 'https://rekt.news/sbi-crypto-rekt', refType: 'investigator', confidence: 'medium', note: 'Listed by rekt.news among the \'theft addresses\' (Litecoin).' },
				{ chain: 'DOGE', address: 'DRiEQuJ9pt3GgNraQmHVTjNg4B7uv1XuGb', role: 'exploiter', ref: 'https://rekt.news/sbi-crypto-rekt', refType: 'investigator', confidence: 'medium', note: 'Listed by rekt.news among the \'theft addresses\' (Dogecoin).' },
				{ chain: 'ETH', address: '0xd2C8EDe41fb84d18353A7ABBcf6448f2E6B664e0', role: 'laundering', ref: 'https://rekt.news/sbi-crypto-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: 1,443 ETH moved here as \'the following laundering address\'; from there 924 ETH went to Tornado Cash and 30 ETH to SideShift.' }
			]
		},
		{
			id: 'swissborg-2025',
			name: 'SwissBorg staking hack (2025-09-08)',
			date: '2025-09-08',
			category: 'hack',
			attribution: 'unknown (third-party API compromise)',
			ref: 'https://rekt.news/swissborg-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 41_500_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'SOL', address: 'TYFWG3hvvxWMs2KXEk8cDuJCsXEyKs65eeqpD9P4mK1', role: 'exploiter', ref: 'https://rekt.news/swissborg-rekt', refType: 'investigator', confidence: 'medium', note: 'Labeled \'SwissBorg Exploiter 1\' by rekt.news, the primary attacker address.' },
				{ chain: 'SOL', address: '2dmoNLgfP1UjqM9ZxtTqWY1YJMHJdXnUkwTrcLhL7Xoq', role: 'laundering', ref: 'https://rekt.news/swissborg-rekt', refType: 'investigator', confidence: 'medium', note: 'Secondary wallet holding the bulk of stolen funds (~189,524 SOL / $40.7M) per rekt.news.' },
				{ chain: 'SOL', address: '6bnSQH4UtGKgo4hUXRj8MeMz2bqPP6hxSaRrBjL96QaT', role: 'laundering', ref: 'https://rekt.news/swissborg-rekt', refType: 'investigator', confidence: 'medium', note: 'Labeled \'SwissBorg Exploiter 2\', an intermediate laundering hop per rekt.news.' },
				{ chain: 'SOL', address: '91XrHcYL9eAFB3G7w53X4mXV4zaaZypVe3MrPCyU43dR', role: 'cashout', ref: 'https://rekt.news/swissborg-rekt', refType: 'investigator', confidence: 'medium', note: 'Secondary laundering intermediary rekt.news says was used to test a centralized-exchange deposit.' }
			]
		},
		{
			id: 'btcturk-2025',
			name: 'BtcTurk hot-wallet hack (2025-08-14)',
			date: '2025-08-14',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (beosin.com). Beosin\'s first group (\'hot wallet addresses where funds have been transferred\') reads as BtcTurk\'s own hot wallets and is left out.',
			lossUsd: 48_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xa041feb3a8297c5689fee180083164a061a17fd6', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'addresses used by hackers to transfer funds\'.' },
				{ chain: 'ETH', address: '0xb4b537626e21df5386cf167d1e654b38785056cc', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'addresses used by hackers to transfer funds\'.' },
				{ chain: 'ETH', address: '0x7d91d1ebeba91257733a523409125aedac5d8b6e', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'addresses used by hackers to transfer funds\'.' },
				{ chain: 'ETH', address: '0x0fe41fe8786329fb6bd8f2baa73aa55e770f0951', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'consolidated address\'.' },
				{ chain: 'ETH', address: '0x95ab53305bc71d0e6e2d46f2e62690599cbc87fc', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'consolidated address\'.' },
				{ chain: 'ETH', address: '0xddfa0884f32d0d210597a996060fbdb5b068b0ea', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'consolidated address\'.' },
				{ chain: 'BTC', address: 'bc1q3xgyvmfk6mw6zvhjklsw7v8wl2dk0xtm35ulut', role: 'laundering', ref: 'https://beosin.com/resources/fund-flow-analysis-of-btcturk-48-million-hack', refType: 'investigator', confidence: 'medium', note: 'Beosin: consolidation address (Bitcoin)' }
			]
		},
		{
			id: 'woox-2025',
			name: 'WOO X hot-wallet hack (2025-07-24)',
			date: '2025-07-24',
			category: 'hack',
			attribution: 'unknown (phishing of a team member)',
			ref: 'https://rekt.news/woox-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news). WOO X\'s own hot wallets listed on the same page are left out.',
			lossUsd: 14_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x87aab7bac1308fAF2A0d59DA26b8379e18b26355', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Ethereum wallet' },
				{ chain: 'ETH', address: '0x889B49ef0bf787c3ddc2950bFC7D1d439320004B', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Ethereum wallet' },
				{ chain: 'ETH', address: '0x77167f0bc412eb39d004f354869938e7c5acd518', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Ethereum wallet' },
				{ chain: 'ETH', address: '0x14896E88E0F7dCe1FB88A979439C2f87b416c024', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Ethereum wallet' },
				{ chain: 'BSC', address: '0x1891438F4CFDFf9e145285A3f15C8b2C52B571CC', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s BSC wallet' },
				{ chain: 'BTC', address: 'bc1q4xm6y972qa82f4cudr4d28xdhxa4e68v5atrej', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Bitcoin wallet' },
				{ chain: 'BTC', address: 'bc1qut0g2uflywfcycuftuek7944p6hhxgm2p92fzm', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Bitcoin wallet' },
				{ chain: 'BTC', address: 'bc1qvd58w5kperw3hzu7j5gkca8rxkzwd7vjxtu2gh', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Bitcoin wallet' },
				{ chain: 'BTC', address: 'bc1qtzlpu326jcqnx8tnhrkqcfxjhn9e02zfutzsch', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Bitcoin wallet' },
				{ chain: 'BTC', address: 'bc1qxvft9ytzjx50ylqnglc0fsd5ck0v6hayl2xsyh', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: attacker\'s Bitcoin wallet' },
				{ chain: 'TRON', address: 'TUchNtdDgLXzhSSC32QaNnzKVPj2rNg8dX', role: 'exploiter', ref: 'https://rekt.news/woox-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news (via Cyvers): attacker\'s TRON wallet' }
			]
		},
		{
			id: 'gmx-2025',
			name: 'GMX V1 exploit (2025-07-09)',
			date: '2025-07-09',
			category: 'exploit',
			attribution: 'unknown; returned the funds for a $5M bounty',
			ref: 'https://www.certik.com/blog/gmx-incident-analysis',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (certik.com).',
			lossUsd: 42_000_000,
			thorchain: { used: 'no', ref: 'https://cointelegraph.com/news/gmx-exploiter-begins-returning-stolen-funds', note: 'funds returned' },
			expand: false,
			addresses: [
				{ chain: 'ARB', address: '0xDF3340A436c27655bA62F8281565C9925C3a5221', role: 'exploiter', ref: 'https://www.certik.com/blog/gmx-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'Labeled \'GMX Exploiter 1\' on Arbiscan; GMX publicly thanked this address after it returned the bulk of the funds.', delisted: { date: '2025-07-11', reason: 'funds returned to GMX under a bounty agreement' } }
			]
		},
		{
			id: 'cetus-2025',
			name: 'Cetus Protocol exploit, Ethereum side (2025-05-22)',
			date: '2025-05-22',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.merklescience.com/blog/hack-track-how-a-shared-library-bug-triggered-the-223m-cetus-hack',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (merklescience.com). The main attacker address is on Sui, a chain Ozone does not parse.',
			lossUsd: 223_000_000,
			thorchain: { used: 'no', ref: 'https://beincrypto.com/decentralization-trust-shaken-cetus-hack/', note: 'bridged funds laundered through Tornado Cash' },
			addresses: [
				{ chain: 'ETH', address: '0x89012a55cd6b88e407c9d4ae9b3425f55924919b', role: 'laundering', ref: 'https://www.merklescience.com/blog/hack-track-how-a-shared-library-bug-triggered-the-223m-cetus-hack', refType: 'investigator', confidence: 'medium', note: 'first Ethereum wallet to receive the funds bridged from Sui' },
				{ chain: 'ETH', address: '0x0251536bfcf144b88e1afa8fe60184ffdb4caf16', role: 'laundering', ref: 'https://www.merklescience.com/blog/hack-track-how-a-shared-library-bug-triggered-the-223m-cetus-hack', refType: 'investigator', confidence: 'medium', note: 'received about $53M from the first Ethereum wallet' }
			]
		},
		{
			id: 'coinbase-phishing-2025-05',
			name: 'Coinbase-user phishing launderer (2025-05-21)',
			date: '2025-05-21',
			category: 'hack',
			attribution: 'unknown; tied by ZachXBT to social-engineering attacks on Coinbase users',
			ref: 'https://decrypt.co/321495?p=321495',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (decrypt.co).',
			lossUsd: 42_500_000,
			thorchain: { used: 'yes', ref: 'https://decrypt.co/321495?p=321495', note: '$42.5M of BTC swapped to ETH through THORChain' },
			addresses: [
				{ chain: 'ETH', address: '0xc84c35f57caeeb5da8e31d1144c293ae5851ab84', role: 'laundering', ref: 'https://decrypt.co/321495?p=321495', refType: 'investigator', confidence: 'medium', note: 'Address the taunt to ZachXBT was sent from (article: \'the hacker wrote... through an Ethereum transaction\'), per Decrypt citing ZachXBT.' }
			]
		},
		{
			id: 'infini-2025',
			name: 'Infini exploit (2025-02-24)',
			date: '2025-02-24',
			category: 'exploit',
			attribution: 'former developer who kept admin rights, per reporting',
			ref: 'https://www.cryptopolitan.com/stablecoin-defi-infini-49m-exploit/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (cryptopolitan.com).',
			lossUsd: 49_500_000,
			thorchain: { used: 'no', ref: 'https://www.cryptopolitan.com/stablecoin-defi-infini-49m-exploit/', note: 'laundered through Tornado Cash' },
			addresses: [
				{ chain: 'ETH', address: '0xc49b5e5b9da66b9126c1a62e9761e6b2147de3e1', role: 'exploiter', ref: 'https://www.cryptopolitan.com/stablecoin-defi-infini-49m-exploit/', refType: 'investigator', confidence: 'medium', note: 'Address of the rogue ex-developer who retained admin control of Infini\'s smart contracts, per PeckShield-derived reporting.' },
				{ chain: 'ETH', address: '0x3ac96134fb0e42a52d33045aee50b89790f05ed0', role: 'laundering', ref: 'https://www.cryptopolitan.com/stablecoin-defi-infini-49m-exploit/', refType: 'investigator', confidence: 'medium', note: 'New wallet the article says withdrew funds shortly after the exploit.' }
			]
		},
		{
			id: 'bybit-2025',
			name: 'Bybit hack (2025-02-21)',
			date: '2025-02-21',
			category: 'hack',
			attribution: 'TraderTraitor (DPRK / Lazarus Group) per FBI PSA I-022625-PSA',
			ref: 'https://www.ic3.gov/PSA/2025/PSA250226',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (amlcrypto.io, merklescience.com). The FBI\'s 51 addresses are in the fbi source; the cluster bybit-2025 expands them with these.',
			lossUsd: 1_460_000_000,
			thorchain: { used: 'yes', ref: 'https://amlcrypto.io/en/blog/event-chronology-bybit-hack', note: 'about 361,000 ETH (~72% of the stolen funds) swapped to BTC through THORChain' },
			window: { from: '2025-02-21T00:00:00Z', to: '2025-06-30T00:00:00Z' },
			addresses: [
				{ chain: 'ETH', address: '0x47666Fab8bd0Ac7003bce3f5C3585383F09486E2', role: 'exploiter', ref: 'https://amlcrypto.io/en/blog/event-chronology-bybit-hack', refType: 'investigator', confidence: 'medium', note: 'Labeled \'Exploiter address\' in AMLCrypto.io chronology (AML/KYT analytics firm, not on rules\' example list but same category as…' },
				{ chain: 'ETH', address: '0xfce75385e6b80a81f3074afcc21b19447f106503', role: 'laundering', ref: 'https://www.merklescience.com/blog/hack-track-bybit-hack-wazirx-connection', refType: 'investigator', confidence: 'medium', note: 'Bybit-hack address in Merkle Science\'s Bybit/WazirX link analysis' }
			]
		},
		{
			id: 'phemex-2025',
			name: 'Phemex hot-wallet hack (2025-01-23)',
			date: '2025-01-23',
			category: 'hack',
			attribution: 'unknown (some analysts suspect DPRK)',
			ref: 'https://quadrigainitiative.com/casestudy/phemexhotwalletaccesscontrolvulnerability.php',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (quadrigainitiative.com).',
			lossUsd: 73_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x5B34414e95a8b8D0B16a39BAf5b97CEc1d517E22', role: 'exploiter', ref: 'https://quadrigainitiative.com/casestudy/phemexhotwalletaccesscontrolvulnerability.php', refType: 'investigator', confidence: 'medium', note: 'Identified as the attacker EOA in Halborn/Merkle Science-derived reporting; address string confirmed present on this case-study…' }
			]
		},
		{
			id: 'm2-2024',
			name: 'M2 exchange hot-wallet hack (2024-10-31)',
			date: '2024-10-31',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://www.quillaudits.com/blog/hack-analysis/m2-crypto-exchange-exploit',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (quillaudits.com).',
			lossUsd: 13_700_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xb5f798096bd4D969466E2284Bda01F7A51049d3A', role: 'exploiter', ref: 'https://www.quillaudits.com/blog/hack-analysis/m2-crypto-exchange-exploit', refType: 'investigator', confidence: 'medium', note: 'QuillAudits: first EOA M2\'s hot wallet funds were transferred to' },
				{ chain: 'ETH', address: '0x968b6984CbA14444F23EE51bE90652408155e142', role: 'exploiter', ref: 'https://www.quillaudits.com/blog/hack-analysis/m2-crypto-exchange-exploit', refType: 'investigator', confidence: 'medium', note: 'QuillAudits: second/final EOA the funds were moved to; ~$10.3M in ETH sat here unmixed as of the report' },
				{ chain: 'BTC', address: 'bc1qu4kh7wa38xpkrp8frgxl4sak88wx0jug8n3vfj', role: 'exploiter', ref: 'https://www.quillaudits.com/blog/hack-analysis/m2-crypto-exchange-exploit', refType: 'investigator', confidence: 'medium', note: 'QuillAudits \'Exploit Details\' summary box, BTC-chain leg' }
			]
		},
		{
			id: 'radiant-2024',
			name: 'Radiant Capital hack (2024-10-16)',
			date: '2024-10-16',
			category: 'hack',
			attribution: 'DPRK-linked per Radiant\'s post-mortem (with Mandiant)',
			ref: 'https://rekt.news/radiant-capital-rekt2',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 53_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x0629b1048298AE9deff0F4100A31967Fb3f98962', role: 'exploiter', ref: 'https://rekt.news/radiant-capital-rekt2', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker Address 1\'' },
				{ chain: 'ETH', address: '0x97a05becc2e7891d07f382457cd5d57fd242e4e8', role: 'exploiter', ref: 'https://rekt.news/radiant-capital-rekt2', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker Address 2\'' },
				{ chain: 'BSC', address: '0x3C2Bc83Dcd293Cc8a23526A37aaeEdD83eBd62de', role: 'exploiter', ref: 'https://rekt.news/radiant-capital-rekt2', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Malicious Contract on ETH\' (address string listed under BSC/ETH deployment in source text)' },
				{ chain: 'BASE', address: '0x30798cFe2CCa822321ceed7e6085e633aAbC492F', role: 'exploiter', ref: 'https://rekt.news/radiant-capital-rekt2', refType: 'investigator', confidence: 'medium', note: 'rekt.news: malicious/compromised contract on BASE that Radiant recommended revoking approval from' },
				{ chain: 'ARB', address: '0x8B75E47976C3C500D0148463931717001F620887', role: 'laundering', ref: 'https://rekt.news/radiant-capital-rekt2', refType: 'investigator', confidence: 'medium', note: 'rekt.news: \'Stolen funds moved to Address on ARB\'' },
				{ chain: 'BSC', address: '0xcF47c058CC4818CE90f9315B478EB2f2d588Cc78', role: 'laundering', ref: 'https://rekt.news/radiant-capital-rekt2', refType: 'investigator', confidence: 'medium', note: 'rekt.news: \'Stolen funds moved to Address on BSC\'' }
			]
		},
		{
			id: 'bingx-2024',
			name: 'BingX hot-wallet hack (2024-09-19)',
			date: '2024-09-19',
			category: 'hack',
			attribution: 'unknown (Lazarus-like pattern per observers)',
			ref: 'https://rekt.news/bingx-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 44_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xf7e8033366166f92eb477b7b38e0d47d47b43326', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 1\' of 10 confirmed' },
				{ chain: 'ETH', address: '0xb0146aec3593410c8307b570af69adf4d74678b3', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 2\'' },
				{ chain: 'ETH', address: '0x940362b46faf7df48af1c8989d809f50466b5fca', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 3\'' },
				{ chain: 'ETH', address: '0x1Dd7dAf089C16856155FeFd7e2170966bb6b3AEE', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 4\'' },
				{ chain: 'ETH', address: '0x719981cf7D1a1dC681a1cf0C6B1eeeE090D0FEd6', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 5\'' },
				{ chain: 'ETH', address: '0xf26e64ef4300ca027d2ffedd7d765d7a3906091c', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 6\'' },
				{ chain: 'ETH', address: '0xb77a4a9678315775c4ba89f18f84f87538e748f5', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 7\'' },
				{ chain: 'ETH', address: '0x63dc352ddfc17aa04edac47ce36e186c1e54b02c', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 8\'' },
				{ chain: 'ETH', address: '0x49284f0ab5098d7effb3392124903c081d1b9f7e', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 9\'' },
				{ chain: 'ETH', address: '0xcfc14fa81226074036622976d95897ff84b58d66', role: 'exploiter', ref: 'https://rekt.news/bingx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Exploiter Address 10\'' }
			]
		},
		{
			id: 'indodax-2024',
			name: 'Indodax hot-wallet hack (2024-09-11)',
			date: '2024-09-11',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://rekt.news/indodax-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 22_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x59101E532bc728599a2d373fCdC7aFf58cB48Df8', role: 'exploiter', ref: 'https://rekt.news/indodax-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: where hackers \'moved their stolen loot\', Ethereum leg ($12.37m)' },
				{ chain: 'ETH', address: '0xB0A2e43D3E0dc4C71346A71484aC6a2627bbCbeD', role: 'exploiter', ref: 'https://rekt.news/indodax-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: misc ERC-20 destination ($1.2m)' },
				{ chain: 'POL', address: '0x90fffbc09e9a5f6d035e92d25d67e244ef5e904f', role: 'exploiter', ref: 'https://rekt.news/indodax-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: Polygon destination ($6.8m)' },
				{ chain: 'TRON', address: 'TBooefeY6FvGuyKfvp5yE1HmzhzvXnvA1P', role: 'exploiter', ref: 'https://rekt.news/indodax-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: Tron destination ($2.55m)' },
				{ chain: 'BTC', address: 'bc1q5uqpn0ha5llrvhcvkq3nfalp8fj7qe3rydcvmf', role: 'exploiter', ref: 'https://rekt.news/indodax-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: BTC destination ($1.4m)' },
				{ chain: 'OP', address: '0x3B8F1131a20e131c195bdA6FDd6e9bE38935eB6d', role: 'exploiter', ref: 'https://rekt.news/indodax-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news: Optimism destination' }
			]
		},
		{
			id: 'penpie-2024',
			name: 'Penpie exploit (2024-09-03)',
			date: '2024-09-03',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (matchsystems.com).',
			lossUsd: 27_000_000,
			thorchain: { used: 'yes', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', note: '4,879 ETH bridged through THORChain to BTC after Tornado Cash' },
			addresses: [
				{ chain: 'ETH', address: '0xd440d2c13e9c0b86f54da4f515f68c56f0c36cc3', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Match Systems: one of 7 addresses the stolen funds were distributed across right after the drain' },
				{ chain: 'ETH', address: '0x37767e2d9131c84441567da5474158b0918b65a4', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same group of 7 initial distribution addresses' },
				{ chain: 'ETH', address: '0x8c37ad70ce51e54d2d75da40668e9530d337f26b', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same group of 7 initial distribution addresses' },
				{ chain: 'ETH', address: '0x10f8c81386a2563f687011f4ebc8f2091cb501e8', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same group of 7 initial distribution addresses' },
				{ chain: 'ETH', address: '0x688413d6cae1c0e0882e274a98e0b901fdf7233c', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same group of 7 initial distribution addresses' },
				{ chain: 'ETH', address: '0xf61aa5fdb43ecbb90ff12086045c9432eee3d03e', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same group of 7 initial distribution addresses' },
				{ chain: 'ETH', address: '0x415a7916c0f52a95f16034d74fb89528c0fc1b11', role: 'laundering', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same group of 7 initial distribution addresses; article notes the hacker tried to obfuscate the trail from here' },
				{ chain: 'BTC', address: 'bc1qqhlf4vau5k9skw3kfleanuc52y9vwevjg3e8du', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Match Systems \'collector\' address receiving THORChain-bridged BTC (1 of ~33; some co-mingled with other hacks\' proceeds per source)' },
				{ chain: 'BTC', address: 'bc1q08xthryj52nf7gmk0j8v8zr8vumt2wfguvftxj', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1q6m6xfryxqplmz07kr0g3atzrcmtnynr3d2r6xd', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qgasehvksj4kj9tz93l5z8eyhqenm42xf9clu7d', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qg62v4q5lgtqq5a87epx56nfhmv4jtmmgcf99el', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qv8tdsa42s7n8z3cj7ygy59lrkr3uumar7qgygy', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qvq79fqwnlyzsruc9qxya0m5g8nl806dtnsug3v', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qfyejx568ephjtwsqt2nt4kfksygsl72grqfr0g', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qk2g2xavrlwqq92lam6hjallx8893cdrxxkqky4', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qp8lptxmzj9hz3pfey37j2kp6vjgadmgfklvdyp', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' },
				{ chain: 'BTC', address: 'bc1qhkkqcmjqgld2kd7p7c7m4svgmtgylhdryzw5f8', role: 'cashout', ref: 'https://matchsystems.com/blog/investigations/penpie-protocol-hack-27-million-dollars-stolen', refType: 'investigator', confidence: 'medium', note: 'Same \'collector\' address set' }
			]
		},
		{
			id: 'wazirx-2024',
			name: 'WazirX multisig hack (2024-07-18)',
			date: '2024-07-18',
			category: 'hack',
			attribution: 'DPRK / Lazarus Group per investigators',
			ref: 'https://www.merklescience.com/blog/hack-track-bybit-hack-wazirx-connection',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (merklescience.com). The overlap address Merkle Science names between the Bybit and WazirX flows is left out: it may be a service.',
			lossUsd: 234_900_000,
			thorchain: { used: 'yes', ref: 'https://www.merklescience.com/blog/hack-track-bybit-hack-wazirx-connection', note: 'stolen ETH converted through THORChain, deBridge and Chainflip' },
			addresses: [
				{ chain: 'ETH', address: '0x9bb7f2bae2e466d72050cc6c92ef197510010218', role: 'laundering', ref: 'https://www.merklescience.com/blog/hack-track-bybit-hack-wazirx-connection', refType: 'investigator', confidence: 'medium', note: 'Labeled \'WazirX Hack\' address in Merkle Science\'s Bybit/WazirX connection analysis.' }
			]
		},
		{
			id: 'lifi-2024',
			name: 'LI.FI exploit (2024-07-16)',
			date: '2024-07-16',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://blocksec.com/blog/illicit-fund-flow-case-study-lifi-attack-metasleuth',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (blocksec.com).',
			lossUsd: 11_600_000,
			thorchain: { used: 'no', ref: 'https://blocksec.com/blog/illicit-fund-flow-case-study-lifi-attack-metasleuth', note: 'funds spread across fresh addresses' },
			addresses: [
				{ chain: 'ETH', address: '0x8b3cb6bf982798fba233bca56749e22eec42dcf3', role: 'exploiter', ref: 'https://blocksec.com/blog/illicit-fund-flow-case-study-lifi-attack-metasleuth', refType: 'investigator', confidence: 'medium', note: 'BlockSec/MetaSleuth: "Attacker\'s Address"' }
			]
		},
		{
			id: 'uwu-lend-2024',
			name: 'UwU Lend exploit (2024-06-10)',
			date: '2024-06-10',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.quillaudits.com/blog/hack-analysis/uwu-lend-hack',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (quillaudits.com).',
			lossUsd: 23_700_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x841dDf093f5188989fA1524e7B893de64B421f47', role: 'exploiter', ref: 'https://www.quillaudits.com/blog/hack-analysis/uwu-lend-hack', refType: 'investigator', confidence: 'medium', note: 'QuillAudits: \'Attacker Address\'' },
				{ chain: 'ETH', address: '0x21C58d8F816578b1193AEf4683E8c64405A4312E', role: 'exploiter', ref: 'https://www.quillaudits.com/blog/hack-analysis/uwu-lend-hack', refType: 'investigator', confidence: 'medium', note: 'QuillAudits: \'Attacker Contract\'' }
			]
		},
		{
			id: 'dmm-bitcoin-2024',
			name: 'DMM Bitcoin hack (2024-05-31)',
			date: '2024-05-31',
			category: 'hack',
			attribution: 'TraderTraitor (DPRK) per FBI, DC3 and Japan\'s National Police Agency',
			ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (beosin.com).',
			lossUsd: 308_000_000,
			thorchain: { used: 'yes', ref: 'https://cryptopotato.com/over-35m-laundered-from-dmm-bitcoin-hack-through-huione-guarantee-data/', note: 'bridged through THORChain among other routes, per ZachXBT' },
			addresses: [
				{ chain: 'BTC', address: '1B6rJRfjTXwEy36SCs5zofGMmdv2kdZw7P', role: 'exploiter', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'The attack address of this incident\'; deliberately crafted to resemble a genuine DMM hot-wallet address (spoofing) so a manual…' },
				{ chain: 'BTC', address: 'bc1qx6jpnnfjrfcx9ehhdmj7qqyzpyd8pek00trrq7', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1qrtltlc7zjzj3knde2tqjt7tl2p5l2keh4l2uka', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1qr4vnu4f4tl3gwfxt6a5hgt6vuusgsd0j2cnz74', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1qgcv2j80009apvjekph40wagwutfu6l3gcm2fw0', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1qegcazuxnp5wxxxamdqvjv345fpve6656vpjln4', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1q7p3atj3v95k4pd7qxnnqlhjwu843ty2hqn9gy0', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1q3ur23g02rq5w0x6y8vek3xradjgs080nzksfje', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1q2u9m2eqy8glvrjeqr5sceqngpad6dnxrtyxlf3', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1q2tu4dxyvnaquar96mj99yqjanfzgg3fv4gzytd', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' },
				{ chain: 'BTC', address: 'bc1q7pdecv2raf3x84unxlv9ghtpjfpwlam6dx27xd', role: 'laundering', ref: 'https://beosin.com/resources/more-than-300-million-in-losses-analysis-of-45029-btc-abnormal-outflow-on-dmm-bitcoin-exchange', refType: 'investigator', confidence: 'medium', note: 'Beosin \'Fund storage address\' (1 of 10)' }
			]
		},
		{
			id: 'hedgey-2024',
			name: 'Hedgey Finance exploit (2024-04-19)',
			date: '2024-04-19',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.certik.com/resources/blog/hedgey-finance-incident-analysis',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (certik.com).',
			lossUsd: 44_700_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xDed2b1a426E1b7d415A40Bcad44e98F47181dda2', role: 'exploiter', ref: 'https://www.certik.com/resources/blog/hedgey-finance-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'CertiK: address that carried out \'the initial exploit ... took 1.3m USDC\'' },
				{ chain: 'ETH', address: '0xC793113F1548B97E37c409f39244EE44241bF2b3', role: 'exploiter', ref: 'https://www.certik.com/resources/blog/hedgey-finance-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'CertiK: "the exploiter\'s contract"' },
				{ chain: 'ARB', address: '0xC7241E27Ee4B8D32b59a10E848B48530047a8c5b', role: 'exploiter', ref: 'https://www.certik.com/resources/blog/hedgey-finance-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'CertiK: \'the third exploiter ... attacked Hedgey Finance on Arbitrum\', funded via Axelar bridge' }
			]
		},
		{
			id: 'fixedfloat-2024',
			name: 'FixedFloat hack (2024-02-18)',
			date: '2024-02-18',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://hackread.com/crypto-exchange-fixedfloat-hacked-btc-eth-stolen/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (hackread.com).',
			lossUsd: 26_100_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x85c4fF99bF0eCb24e02921b0D4b5d336523Fa085', role: 'exploiter', ref: 'https://hackread.com/crypto-exchange-fixedfloat-hacked-btc-eth-stolen/', refType: 'investigator', confidence: 'medium', note: 'hackread.com quotes investigator @officer_cia (X/Twitter): \'Drainer on Ethereum (1700 ETH stolen)\'' }
			]
		},
		{
			id: 'orbit-2024',
			name: 'Orbit Chain bridge hack (2024-01-01)',
			date: '2024-01-01',
			category: 'hack',
			attribution: 'unknown (7 of 10 bridge signers compromised)',
			ref: 'https://beosin.com/resources/the-orbit-chain-incident-unraveling-the-story-behind-the-80-million-heist--first-case-of-2024',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (beosin.com).',
			lossUsd: 81_500_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x27e2cc59a64d705a6c3d3d306186c2a55dcd5710', role: 'exploiter', ref: 'https://beosin.com/resources/the-orbit-chain-incident-unraveling-the-story-behind-the-80-million-heist--first-case-of-2024', refType: 'investigator', confidence: 'medium', note: 'Beosin: \'the hacker\'s address\'; used stolen ETH to fund 5 further attack addresses (not individually quoted in the article)' }
			]
		},
		{
			id: 'kyberswap-2023',
			name: 'KyberSwap Elastic exploit (2023-11-23)',
			date: '2023-11-23',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (blog.kyberswap.com).',
			lossUsd: 48_700_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x50275E0B7261559cE1644014d4b78D4AA63BE836', role: 'exploiter', ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/', refType: 'victim', confidence: 'high', note: 'KyberSwap\'s own post-mortem table: \'Exploiter 1\' (primary exploiter, $48.67M), status Confirmed' },
				{ chain: 'ETH', address: '0xC9B826BAD20872EB29f9b1D8af4BefE8460b50c6', role: 'exploiter', ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/', refType: 'victim', confidence: 'high', note: 'KyberSwap post-mortem table: Exploiter 1, status Confirmed' },
				{ chain: 'ETH', address: '0x98d69d3ea5f7e03098400a5bedfbe49f2b0b88d3', role: 'exploiter', ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/', refType: 'victim', confidence: 'high', note: 'KyberSwap post-mortem table: Exploiter 1, status Confirmed' },
				{ chain: 'ETH', address: '0x5E42DD64266C3852cad3d294f71b171459Cf0a48', role: 'exploiter', ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/', refType: 'victim', confidence: 'high', note: 'KyberSwap post-mortem table: Exploiter 1, status Confirmed' },
				{ chain: 'ETH', address: '0x4ea83653ecea38b51730c14776698e19f5ca6e65', role: 'exploiter', ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/', refType: 'victim', confidence: 'high', note: 'KyberSwap post-mortem table: Exploiter 1, status Confirmed' },
				{ chain: 'ETH', address: '0xa423c7be031e988b25fb7ec39b7906582f6858c6', role: 'exploiter', ref: 'https://blog.kyberswap.com/post-mortem-kyberswap-elastic-exploit/', refType: 'victim', confidence: 'high', note: 'KyberSwap post-mortem table: Exploiter 1, status Confirmed' }
			]
		},
		{
			id: 'heco-htx-2023',
			name: 'HECO bridge and HTX hot-wallet hack (2023-11-22)',
			date: '2023-11-22',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://rekt.news/heco-htx-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 100_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xfc146d1caf6ba1d1ce6dcb5b35dcbf895f50b0c4', role: 'exploiter', ref: 'https://rekt.news/heco-htx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news labels this \'HECO attacker address\'' },
				{ chain: 'ETH', address: '0x5a22f867dfcb4f32d25a5fa365b9d9d78d5515dc', role: 'exploiter', ref: 'https://rekt.news/heco-htx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news labels this \'HTX attacker 1 (ETH)\'' },
				{ chain: 'ETH', address: '0x121a0ff24027fffcdd0ae008da82f2789c7945cc', role: 'exploiter', ref: 'https://rekt.news/heco-htx-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news labels this \'HTX attacker 2 (other assets)\'' }
			]
		},
		{
			id: 'poloniex-2023',
			name: 'Poloniex hot-wallet hack (2023-11-10)',
			date: '2023-11-10',
			category: 'hack',
			attribution: 'DPRK / Lazarus Group per Elliptic',
			ref: 'https://rekt.news/poloniex-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 126_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x0a5984f86200415894821bfefc1c1de036dbf9e7', role: 'exploiter', ref: 'https://rekt.news/poloniex-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Main attacker address (ETH)\', citing Arkham\'s attacker profile' },
				{ chain: 'TRON', address: 'TKK6d1YALy8HCSoCSWWd1ZJhyC9NPPx4wa', role: 'exploiter', ref: 'https://rekt.news/poloniex-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Main attacker address (TRON)\'' },
				{ chain: 'BTC', address: 'bc1qnpc7u2ha7ct9c458rrqsawylz9e9j6jvkvzttt', role: 'exploiter', ref: 'https://rekt.news/poloniex-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Main attacker address (BTC)\'' }
			]
		},
		{
			id: 'coinex-2023',
			name: 'CoinEx hot-wallet hack (2023-09-12)',
			date: '2023-09-12',
			category: 'hack',
			attribution: 'DPRK / Lazarus Group per investigators (ZachXBT, SlowMist)',
			ref: 'https://bitok.org/blog/lazarus_attacks',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (bitok.org).',
			lossUsd: 54_000_000,
			thorchain: { used: 'yes', ref: 'https://bitok.org/blog/lazarus_attacks', note: 'ETH and BNB proceeds swapped to BTC through THORChain' },
			addresses: [
				{ chain: 'ETH', address: '0x0406c938a8A77F41C360b5304f6811078E42dA3b', role: 'laundering', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: '\'A significant portion of the funds was sent to\' this address before dispersal to THORChain.' },
				{ chain: 'BTC', address: 'bc1qy06xsq9yx93d02n95mv5y09z8fzy6usrj09ndy', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'USDT->ETH (Allbridge)->THORChain->BTC destination; matches task\'s given lead.' },
				{ chain: 'BTC', address: 'bc1qzed4cka5972m3x5uh254msyn3f7sfqvcdkhv2k', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Same laundering leg; matches task\'s given lead.' },
				{ chain: 'BTC', address: 'bc1qnjsclu7xuarcewcxw85umq4ffrmaegvk0rfnat', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Same laundering leg (Allbridge->THORChain->BTC).' },
				{ chain: 'BTC', address: 'bc1qa45rjs5sqz7m78m6jhu74myzcdswzp52f4n44z', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Same laundering leg (Allbridge->THORChain->BTC).' },
				{ chain: 'BTC', address: 'bc1qphh2mnrdwe7p5jxjxnzwsjsxhzyxzy0emzq0e5', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'ETH-leg THORChain->BTC destination.' },
				{ chain: 'BTC', address: 'bc1qrxv4mx56x0aus73f65asfgd99gp8hll3aeej9l', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'ETH-leg THORChain->BTC destination.' },
				{ chain: 'BTC', address: 'bc1qf5papnvu23hsm6mz5hvgcgwmd7te80yza4emay', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'ETH-leg THORChain->BTC destination.' },
				{ chain: 'BTC', address: 'bc1q52y7ktl0h7x3sjy94zv8je753fweprh454tg6n', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'BNB-leg: BNB->USDT->Stargate->ETH->THORChain->BTC destination.' },
				{ chain: 'BTC', address: '3BhLKKb2ePaswCAsD8diyupYSMX5PeSvV5', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'BNB-leg THORChain->BTC destination (legacy address format).' },
				{ chain: 'BTC', address: 'bc1qu2rhaua3q7xqj8gfqgt92xher9qg5093mm689p', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'BNB-leg THORChain->BTC destination.' },
				{ chain: 'TRON', address: 'TB3ixJUBMQsfELigRodctY6kBhZ74G48UX', role: 'laundering', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'TRX sent here then swapped for USDT on SunSwap (pre-THORChain leg).' },
				{ chain: 'TRON', address: 'TMuMk21X6Gzm6ErNoAhGirWxX1aei4ixwo', role: 'laundering', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Second TRX SunSwap routing address (pre-THORChain leg).' }
			]
		},
		{
			id: 'stake-2023',
			name: 'Stake.com hot-wallet hack (2023-09-04)',
			date: '2023-09-04',
			category: 'hack',
			attribution: 'TraderTraitor (DPRK / Lazarus Group) per FBI',
			ref: 'https://bitok.org/blog/lazarus_attacks',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (bitok.org). The FBI press release of 2023-09-06 (fbi.gov, not fetchable automatically) names the Stake.com addresses on ETH, BSC and POL.',
			lossUsd: 41_000_000,
			thorchain: { used: 'yes', ref: 'https://bitok.org/blog/lazarus_attacks', note: 'ETH routed to THORChain and swapped to BTC' },
			addresses: [
				{ chain: 'ETH', address: '0xa4694f58A2445c5BF89405bc20E87fe6D8622356', role: 'exploiter', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'One of two addresses the initial Lazarus-linked (OFAC-listed) wallets sent funds to. Matches address named in FBI-related task lead.' },
				{ chain: 'ETH', address: '0xc8A03DaaB82DB33Af11a48Bdb1E0e2B59C4c62Fb', role: 'exploiter', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Second of the two initial distribution addresses. Matches task\'s FBI-related lead.' },
				{ chain: 'ETH', address: '0x1154926C6AC4Be7A6C979D11ca2921D3e77BaaA1', role: 'laundering', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Stolen USDT_ETH partially directed here, then swapped via Uniswap.' },
				{ chain: 'ETH', address: '0xdD5F63753b578cc801d11572e80C62ee97BB3571', role: 'laundering', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Received funds after Uniswap swap, then sent to THORChain.' },
				{ chain: 'BTC', address: 'bc1q6z6y8e335wd3ys5zr0qvqpgztw359w0e9zlpgm', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: '\'One of the Bitcoin addresses of the recipients\' after ETH->USDT->THORChain->BTC. Matches task\'s given lead.' },
				{ chain: 'BTC', address: 'bc1qfddxamm7dd4wph4wtru22s4zjek0e0umzj7z7k', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Funds \'still remain\' here, not associated with any service.' },
				{ chain: 'BTC', address: 'bc1q4k9lreq9thdw9d33xh89nx8n5m9rpm6qr9ejea', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'BTC destination after THORChain ETH->BTC chain-hop.' },
				{ chain: 'BTC', address: 'bc1q9xn3va65wwvmynyxmu6a4cc32tyjw7a0fjm2wj', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Dormant BTC address holding proceeds.' },
				{ chain: 'BTC', address: 'bc1qyzkpyvxlpyqjca6kjfpdn49rfpzm6t97p2sadn', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Dormant BTC address holding proceeds.' },
				{ chain: 'BTC', address: 'bc1qrpyx42mmss76d7f5nnq33uv37epuwakgufg0gr', role: 'cashout', ref: 'https://bitok.org/blog/lazarus_attacks', refType: 'investigator', confidence: 'medium', note: 'Dormant BTC address holding proceeds.' }
			]
		},
		{
			id: 'fbi-dprk-2023-08-22',
			name: 'DPRK heists 2023: Atomic Wallet, Alphapo, CoinsPaid, Stake.com (FBI list of 2023-08-22)',
			date: '2023-08-22',
			category: 'law_enforcement',
			code: 'FBI_DPRK',
			attribution: 'TraderTraitor (DPRK / Lazarus Group) per FBI',
			ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk',
			verification: 'fbi.gov blocks automated fetches; the FBI text is quoted in full at https://www.hngn.com/articles/251482/20230823/fbi-identifies-cryptocurrency-funds-stolen-dprk.htm, where every address appears verbatim. Addresses are checksum-valid and their on-chain history (about 1,580 BTC received in total) matches the amount the FBI named. Verified 2026-09-27 and 2026-09-28.',
			thorchain: { used: 'unknown' },
			window: { from: '2023-08-01T00:00:00Z', to: '2024-02-29T00:00:00Z' },
			addresses: [
				{ chain: 'BTC', address: '3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG', role: 'laundering', ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '39idqitN9tYNmq3wYanwg3MitFB5TZCjWu', role: 'laundering', ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '3AAUBbKJorvNhEUFhKnep9YTwmZECxE4Nk', role: 'laundering', ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '3PjNaSeP8GzLjGeu51JR19Q2Lu8W2Te9oc', role: 'laundering', ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '3NbdrezMzAVVfXv5MTQJn4hWqKhYCTCJoB', role: 'laundering', ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '34VXKa5upLWVYMXmgid6bFM4BaQXHxSUoL', role: 'laundering', ref: 'https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk', refType: 'law_enforcement', confidence: 'high' }
			]
		},
		{
			id: 'curve-vyper-2023',
			name: 'Curve pools / Vyper reentrancy exploits (2023-07-30)',
			date: '2023-07-30',
			category: 'exploit',
			attribution: 'unknown; most funds returned',
			ref: 'https://rekt.news/curve-vyper-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 70_000_000,
			thorchain: { used: 'unknown' },
			expand: false,
			addresses: [
				{ chain: 'ETH', address: '0xB1C33b391C2569B737eC387E731E88589e8ec148', role: 'exploiter', ref: 'https://rekt.news/curve-vyper-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s addresses\': Curve pool', delisted: { date: '2023-08-15', reason: 'most funds returned after bounty negotiations (rekt.news)' } },
				{ chain: 'ETH', address: '0xb752def3a1fded45d6c4b9f4a8f18e645b41b324', role: 'exploiter', ref: 'https://rekt.news/curve-vyper-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s addresses\': Curve pool (second address)', delisted: { date: '2023-08-15', reason: 'most funds returned after bounty negotiations (rekt.news)' } },
				{ chain: 'ETH', address: '0x6ec21d1868743a44318c3c259a6d4953f9978538', role: 'exploiter', ref: 'https://rekt.news/curve-vyper-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s addresses\': JPEG\'d pool', delisted: { date: '2023-08-15', reason: 'most funds returned after bounty negotiations (rekt.news)' } },
				{ chain: 'ETH', address: '0xdce5d6b41c32f578f875efffc0d422c57a75d7d8', role: 'exploiter', ref: 'https://rekt.news/curve-vyper-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s addresses\': Alchemix pool', delisted: { date: '2023-08-15', reason: 'most funds returned after bounty negotiations (rekt.news)' } }
			]
		},
		{
			id: 'alphapo-2023',
			name: 'Alphapo hot-wallet hack (2023-07-22)',
			date: '2023-07-22',
			category: 'hack',
			attribution: 'DPRK / Lazarus Group per FBI',
			ref: 'https://rekt.news/alphapo-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 60_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x040a96659fd7118259ebcd547771f6ecb9580d17', role: 'exploiter', ref: 'https://rekt.news/alphapo-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news lists under \'Attacker\'s main addresses\'' },
				{ chain: 'ETH', address: '0x6d2e8a20b8afa88d92406d315b67822c01e53c38', role: 'exploiter', ref: 'https://rekt.news/alphapo-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s main addresses\'; described as secondary consolidation account' },
				{ chain: 'ETH', address: '0xde374094C837D192B61972172740BDAfc4eE16E0', role: 'exploiter', ref: 'https://rekt.news/alphapo-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s main addresses\'' },
				{ chain: 'TRON', address: 'TKSitnfTLVMRbJsF1i2UH5hNUeHLDrXDiY', role: 'exploiter', ref: 'https://rekt.news/alphapo-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s main addresses\' (TRON)' },
				{ chain: 'TRON', address: 'TDoNAZHa7WxarUAFbQUhiijTGtd7EpbzRh', role: 'exploiter', ref: 'https://rekt.news/alphapo-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s main addresses\' (TRON)' },
				{ chain: 'TRON', address: 'TJF7mdFxDuHB4tb9hoyR4SCpKxk7gr23ym', role: 'exploiter', ref: 'https://rekt.news/alphapo-rekt', refType: 'investigator', confidence: 'medium', note: 'rekt.news \'Attacker\'s main addresses\' (TRON)' }
			]
		},
		{
			id: 'multichain-2023',
			name: 'Multichain bridge drain (2023-07-06)',
			date: '2023-07-06',
			category: 'hack',
			attribution: 'unclear (insider or key compromise after the CEO\'s detention)',
			ref: 'https://www.chainalysis.com/blog/multichain-exploit-july-2023/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (chainalysis.com).',
			lossUsd: 126_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x1eed63efba5f81d95bfe37d82c8e736b974f477b', role: 'exploiter', ref: 'https://www.chainalysis.com/blog/multichain-exploit-july-2023/', refType: 'investigator', confidence: 'medium', note: 'Chainalysis: address allegedly controlled by Multichain CEO Zhaojun\'s sister that received drained funds \'for asset preservation\'' },
				{ chain: 'ETH', address: '0x6b6314f4f07c974600d872182dcde092c480e57b', role: 'exploiter', ref: 'https://www.chainalysis.com/blog/multichain-exploit-july-2023/', refType: 'investigator', confidence: 'medium', note: 'Same as above, second address' }
			]
		},
		{
			id: 'euler-2023',
			name: 'Euler Finance exploit (2023-03-13)',
			date: '2023-03-13',
			category: 'exploit',
			attribution: 'unknown; all funds returned',
			ref: 'https://www.chainalysis.com/blog/euler-finance-flash-loan-attack/',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (chainalysis.com).',
			lossUsd: 197_000_000,
			thorchain: { used: 'no', ref: 'https://www.chainalysis.com/blog/euler-finance-flash-loan-attack/', note: 'funds returned' },
			expand: false,
			addresses: [
				{ chain: 'ETH', address: '0xb66cd966670d962C227B3EABA30a872DbFb995db', role: 'exploiter', ref: 'https://www.chainalysis.com/blog/euler-finance-flash-loan-attack/', refType: 'investigator', confidence: 'medium', note: 'Chainalysis: \'the hacker\'s primary personal wallet\'', delisted: { date: '2023-04-04', reason: 'all funds returned to Euler after negotiation' } }
			]
		},
		{
			id: 'ankr-helio-2022',
			name: 'Ankr aBNBc exploit and Helio losses (2022-12-02)',
			date: '2022-12-02',
			category: 'exploit',
			attribution: 'unknown (compromised deployer key per Ankr)',
			ref: 'https://smartcontractshacking.com/hacks/ankr-hack-2022',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (smartcontractshacking.com).',
			lossUsd: 20_500_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'BSC', address: '0xf3a465C9fA6663fF50794C698F600Faa4b05c777', role: 'exploiter', ref: 'https://smartcontractshacking.com/hacks/ankr-hack-2022', refType: 'investigator', confidence: 'medium', note: 'Address that used the infinite-mint bug to mint 60 trillion aBNBc across 6 transactions.' }
			]
		},
		{
			id: 'ftx-2022',
			name: 'FTX accounts drainer (2022-11-11)',
			date: '2022-11-11',
			category: 'hack',
			attribution: 'unknown (SIM-swap thieves later charged by DOJ)',
			ref: 'https://cointelegraph.com/news/ftx-hacker-is-now-the-35th-largest-holder-of-eth',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (cointelegraph.com).',
			lossUsd: 477_000_000,
			thorchain: { used: 'yes', ref: 'https://cointelegraph.com/news/ftx-hacker-is-now-the-35th-largest-holder-of-eth', note: 'about 72,500 ETH converted to BTC through THORSwap/THORChain after RenBridge' },
			window: { from: '2022-11-11T00:00:00Z', to: '2023-12-31T00:00:00Z' },
			addresses: [
				{ chain: 'ETH', address: '0x59ABf3837Fa962d6853b4Cc0a19513AA031fd32b', role: 'exploiter', ref: 'https://cointelegraph.com/news/ftx-hacker-is-now-the-35th-largest-holder-of-eth', refType: 'investigator', confidence: 'medium', note: 'Labeled \'FTX Accounts Drainer\'; Elliptic\'s original blockchain-trail research names this as the hacker\'s wallet.' }
			]
		},
		{
			id: 'bnb-bridge-2022',
			name: 'BNB Chain Token Hub bridge exploit (2022-10-06)',
			date: '2022-10-06',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.elliptic.co/blog/analysis/attack-mints-569-million-worth-of-bnb-tokens-in-bsc-bridge-exploit',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (elliptic.co).',
			lossUsd: 570_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'BSC', address: '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc', role: 'exploiter', ref: 'https://www.elliptic.co/blog/analysis/attack-mints-569-million-worth-of-bnb-tokens-in-bsc-bridge-exploit', refType: 'investigator', confidence: 'medium', note: 'Address that received 2 million BNB minted via the forged proof-verification exploit.' }
			]
		},
		{
			id: 'wintermute-2022',
			name: 'Wintermute vault hack (2022-09-20)',
			date: '2022-09-20',
			category: 'hack',
			attribution: 'unknown (Profanity vanity-key weakness)',
			ref: 'https://www.halborn.com/blog/post/explained-the-wintermute-hack-september-2022',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (halborn.com).',
			lossUsd: 160_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xe74b28c2eAe8679e3cCc3a94d5d0dE83CCB84705', role: 'exploiter', ref: 'https://www.halborn.com/blog/post/explained-the-wintermute-hack-september-2022', refType: 'investigator', confidence: 'medium', note: 'Address the compromised vault\'s ether, WBTC and other tokens (~$118.4M) were drained to.' }
			]
		},
		{
			id: 'nomad-2022',
			name: 'Nomad bridge exploit (2022-08-01)',
			date: '2022-08-01',
			category: 'exploit',
			attribution: 'unknown (copy-paste exploit by many addresses)',
			ref: 'https://rekt.news/nomad-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news). The three largest of 40+ extracting addresses.',
			lossUsd: 190_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x56D8B635A7C88Fd1104D23d632AF40c1C3Aac4e3', role: 'exploiter', ref: 'https://rekt.news/nomad-rekt', refType: 'investigator', confidence: 'medium', note: 'Largest single extractor, ~$47M.' },
				{ chain: 'ETH', address: '0xBF293D5138a2a1BA407B43672643434C43827179', role: 'exploiter', ref: 'https://rekt.news/nomad-rekt', refType: 'investigator', confidence: 'medium', note: 'Second-largest extractor, ~$40M.' },
				{ chain: 'ETH', address: '0xB5C55f76f90Cc528B2609109Ca14d8d84593590E', role: 'exploiter', ref: 'https://rekt.news/nomad-rekt', refType: 'investigator', confidence: 'medium', note: 'Third-largest extractor, ~$8M.' }
			]
		},
		{
			id: 'beanstalk-2022',
			name: 'Beanstalk governance exploit (2022-04-17)',
			date: '2022-04-17',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.certik.com/blog/revisiting-beanstalk-farms-exploit',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (certik.com).',
			lossUsd: 182_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x1c5dcdd006ea78a7e4783f9e6021c32935a10fb4', role: 'exploiter', ref: 'https://www.certik.com/blog/revisiting-beanstalk-farms-exploit', refType: 'investigator', confidence: 'medium', note: 'Wallet that received the ~$76-80M profit from the flash-loan governance attack.' }
			]
		},
		{
			id: 'ronin-2022',
			name: 'Ronin bridge hack (2022-03-23)',
			date: '2022-03-23',
			category: 'hack',
			attribution: 'DPRK / Lazarus Group per OFAC and FBI',
			ref: 'https://ofac.treasury.gov/recent-actions/20220414',
			verification: 'Checked 2026-09-28: the address is valid (EIP-55) and appears verbatim in OFAC\'s North Korea designation update of 2022-04-14 (the Lazarus Group entry); also at merklescience.com. OFAC designated the address on 2022-04-14 (it is also in the ofac_sdn source).',
			lossUsd: 620_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96', role: 'exploiter', ref: 'https://ofac.treasury.gov/recent-actions/20220414', refType: 'sanctions', confidence: 'high', note: 'OFAC added this ETH address to the Lazarus Group SDN entry on 2022-04-14; it received 173,600 ETH and 25.5M USDC directly from the Ronin…' }
			]
		},
		{
			id: 'wormhole-2022',
			name: 'Wormhole bridge exploit (2022-02-02)',
			date: '2022-02-02',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (certik.com).',
			lossUsd: 326_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'SOL', address: 'CxegPrfn2ge5dNiQberUrQJkHCcimeR4VXkeawcFBBka', role: 'exploiter', ref: 'https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'Held 432,662 SOL (~$46.6M) from the exploit.' },
				{ chain: 'SOL', address: '2SDN4vEJdCdW3pGyhx2km9gB3LeHzMGLrG2j4uVNZfrx', role: 'exploiter', ref: 'https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'Account that minted the fraudulent 120,000 wETH.' },
				{ chain: 'ETH', address: '0x629e7da20197a5429d30da36e77d06cdf796b71a', role: 'exploiter', ref: 'https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis', refType: 'investigator', confidence: 'medium', note: 'Held 93,750 stolen wETH (~$251.7M) on Ethereum.' }
			]
		},
		{
			id: 'qubit-2022',
			name: 'Qubit Finance bridge exploit (2022-01-27)',
			date: '2022-01-27',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-qubit-finance-exploit',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (merklescience.com).',
			lossUsd: 80_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'BSC', address: '0xd01ae1a708614948b2b5e0b7ab5be6afa01325c7', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-qubit-finance-exploit', refType: 'investigator', confidence: 'medium', note: 'Address Qubit Finance itself identified as the attacker on 2022-01-28; minted qXETH and swapped to ~$77M in BNB via PancakeSwap.' }
			]
		},
		{
			id: 'vulcan-forged-2021',
			name: 'Vulcan Forged wallet hack (2021-12-13)',
			date: '2021-12-13',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://fairyproof.substack.com/p/fairyproofs-analysis-of-the-attack-on-vulcan-forged-615cff0153df',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (fairyproof.substack.com).',
			lossUsd: 140_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x48ad05a3B73c9E7fAC5918857687d6A11d2c73B1', role: 'exploiter', ref: 'https://fairyproof.substack.com/p/fairyproofs-analysis-of-the-attack-on-vulcan-forged-615cff0153df', refType: 'investigator', confidence: 'medium', note: 'Address that drained 96 compromised MyForge/Venly-hosted wallets of ~4.5M PYR.' }
			]
		},
		{
			id: 'bitmart-2021',
			name: 'BitMart hot-wallet hack (2021-12-04)',
			date: '2021-12-04',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://www.merklescience.com/blog/hack-track-analysis-on-bitmart-hack',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (merklescience.com).',
			lossUsd: 196_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x39fb0dcd13945b835d47410ae0de7181d3edf270', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-on-bitmart-hack', refType: 'investigator', confidence: 'medium', note: '\'H1\' - first received 148.87 ETH from BitMart\'s ETH hot wallet.' },
				{ chain: 'ETH', address: '0x4bb7d80282f5e0616705d7f832acfc59f89f7091', role: 'laundering', ref: 'https://www.merklescience.com/blog/hack-track-analysis-on-bitmart-hack', refType: 'investigator', confidence: 'medium', note: '\'H2\' - received 18,085 ETH forwarded from H1.' },
				{ chain: 'BSC', address: '0x25fb126b6c6b5c8ef732b86822fa0f0024e16c61', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-on-bitmart-hack', refType: 'investigator', confidence: 'medium', note: '\'H3\' - received 213.57 BNB from BitMart\'s BSC hot wallet.' }
			]
		},
		{
			id: 'badgerdao-2021',
			name: 'BadgerDAO front-end attack (2021-12-02)',
			date: '2021-12-02',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://rekt.news/badger-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 120_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x1fcdb04d0c5364fbd92c73ca8af9baa72c269107', role: 'exploiter', ref: 'https://rekt.news/badger-rekt', refType: 'investigator', confidence: 'medium', note: 'Address over 500 victim wallets were phished into approving; drained ~$120M in BTC/ETH-denominated tokens.' }
			]
		},
		{
			id: 'cream-2021',
			name: 'Cream Finance exploit (2021-10-27)',
			date: '2021-10-27',
			category: 'exploit',
			attribution: 'unknown',
			ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-c-r-e-a-m-finance-hack',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (merklescience.com).',
			lossUsd: 130_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0x24354d31bc9d90f62fe5f2454709c32049cf866b', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-c-r-e-a-m-finance-hack', refType: 'investigator', confidence: 'medium', note: 'Reentrancy exploit via the AMP/yUSDVault integration; third and largest Cream hack of 2021.' }
			]
		},
		{
			id: 'liquid-2021',
			name: 'Liquid Global hot-wallet hack (2021-08-19)',
			date: '2021-08-19',
			category: 'hack',
			attribution: 'unknown',
			ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-liquid-global-security-breach',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (merklescience.com).',
			lossUsd: 91_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'BTC', address: '1Fx1bhbCwp5LU2gHxfRNiSHi1QSHwZLf7q', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-liquid-global-security-breach', refType: 'investigator', confidence: 'medium', note: 'Received 107.32 BTC (~$4.3M).' },
				{ chain: 'XRP', address: 'rfapBqj7rUkGju7oHTwBwhEyXgwkEM4yby', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-liquid-global-security-breach', refType: 'investigator', confidence: 'medium', note: 'Received 11,508,516 XRP (~$13.1M) across 4 transactions.' },
				{ chain: 'ETH', address: '0x5578840AAe68682a9779623Fa9e8714802B59946', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-liquid-global-security-breach', refType: 'investigator', confidence: 'medium', note: 'One of six ETH wallets Merkle Science says received looted ETH/ERC-20 funds.' },
				{ chain: 'ETH', address: '0xEFB33ccafC98d5fDB27A6F5Ff17350CA76BF3b53', role: 'exploiter', ref: 'https://www.merklescience.com/blog/hack-track-analysis-of-liquid-global-security-breach', refType: 'investigator', confidence: 'medium', note: 'Another of the six ETH wallets.' }
			]
		},
		{
			id: 'poly-network-2021',
			name: 'Poly Network exploit (2021-08-10)',
			date: '2021-08-10',
			category: 'exploit',
			attribution: 'unknown; funds returned',
			ref: 'https://rekt.news/polynetwork-rekt',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (rekt.news).',
			lossUsd: 611_000_000,
			thorchain: { used: 'no', ref: 'https://en.wikipedia.org/wiki/Poly_Network_exploit', note: 'funds returned' },
			expand: false,
			addresses: [
				{ chain: 'ETH', address: '0xC8a65Fadf0e0dDAf421F28FEAb69Bf6E2E589963', role: 'exploiter', ref: 'https://rekt.news/polynetwork-rekt', refType: 'investigator', confidence: 'medium', note: 'Attacker\'s Ethereum address.', delisted: { date: '2021-08-23', reason: 'nearly all funds returned to Poly Network' } },
				{ chain: 'BSC', address: '0x0D6e286A7cfD25E0c01fEe9756765D8033B32C71', role: 'exploiter', ref: 'https://rekt.news/polynetwork-rekt', refType: 'investigator', confidence: 'medium', note: 'Attacker\'s BSC address.', delisted: { date: '2021-08-23', reason: 'nearly all funds returned to Poly Network' } },
				{ chain: 'POL', address: '0x5dc3603C9D42Ff184153a8a9094a73d461663214', role: 'exploiter', ref: 'https://rekt.news/polynetwork-rekt', refType: 'investigator', confidence: 'medium', note: 'Attacker\'s Polygon address, which alone moved 85,089,719 USDC.', delisted: { date: '2021-08-23', reason: 'nearly all funds returned to Poly Network' } }
			]
		},
		{
			id: 'kucoin-2020',
			name: 'KuCoin hot-wallet hack (2020-09-26)',
			date: '2020-09-26',
			category: 'hack',
			attribution: 'DPRK / Lazarus Group per Chainalysis (not law enforcement)',
			ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (kucoin.com).',
			lossUsd: 281_000_000,
			thorchain: { used: 'unknown' },
			addresses: [
				{ chain: 'ETH', address: '0xeb31973e0febf3e3d7058234a5ebbae1ab4b8c23', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high', note: 'KuCoin\'s own list of hacker withdrawal addresses to blacklist' },
				{ chain: 'BTC', address: '1TYyommJW3uhjhcnHhUSuTQFqSBAxBDPV', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high' },
				{ chain: 'BTC', address: '12FACbewf5Fy9nmeaLQtm6Ugo5WS8g2Hay', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high' },
				{ chain: 'BTC', address: '1NRsEQRg5EjmJHbPUX7YADVPcPzCQBkyU7', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high' },
				{ chain: 'LTC', address: 'LQtFoidy5TmLrPP77MZzgMRffqPsmRfMXE', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high' },
				{ chain: 'XRP', address: 'r3mZvvHVLPtRWAujzBsAoXqH11jhwQZvzY', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high' },
				{ chain: 'TRON', address: 'TB3j1gUXaLXXq2bstiSMfjQ9R7Yh9DdDgK', role: 'exploiter', ref: 'https://www.kucoin.com/announcement/en-the-latest-updates-about-the-kucoin-security-incident', refType: 'victim', confidence: 'high' }
			]
		},
		{
			id: 'doj-dprk-2019-exchanges',
			name: 'DPRK hacks of two exchanges, 2019 (DOJ forfeiture complaint of 2020-08-27)',
			date: '2019-07-01',
			category: 'law_enforcement',
			code: 'DOJ_DPRK',
			attribution: 'DPRK cyber actors per DOJ, FBI, IRS-CI and HSI',
			ref: 'https://www.justice.gov/opa/pr/united-states-files-complaint-forfeit-280-cryptocurrency-accounts-tied-hacks-two-exchanges',
			verification: 'Checked 2026-09-28: every address is valid for its chain (checksums) and appears verbatim on its cited page (justice.gov); checked against the complaint PDF text (pdftotext). 21 of the complaint\'s 280 defendant accounts (ETH and BTC); ALGO accounts are not parsed.',
			lossUsd: 2_740_855,
			thorchain: { used: 'no', ref: 'https://www.justice.gov/opa/pr/united-states-files-complaint-forfeit-280-cryptocurrency-accounts-tied-hacks-two-exchanges', note: 'laundered in 2019-2020 through chain hopping and OTC traders' },
			expand: false,
			addresses: [
				{ chain: 'ETH', address: '0x52cbb6be7ad204904486f89e264029c94525966d', role: 'exploiter', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Attachment A, Defendant Property 2; received PXG tokens directly from the hacked exchange\'s own wallet. Verified by pdftotext…' },
				{ chain: 'ETH', address: '0xeda8b016efa8b1161208cf041cd86972eee0f31e', role: 'exploiter', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Attachment A, Defendant Property 3; received IHT tokens directly from the hack.' },
				{ chain: 'BTC', address: '3QAmBJmK4PbEg1QeKoVYWcP5LGUsjRodcb', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'ETH', address: '0x1016b7835d409692e02ed2035e053fbfb4602982', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Attachment A, Defendant Property 5; intermediary address.' },
				{ chain: 'ETH', address: '0x46705dfff24256421a05d056c29e81bdc09723b8', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'ETH', address: '0x2DBC0f6B71e341C7Eca01c5287Eb57AF3038A9c5', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Attachment A, Defendant Property 7.' },
				{ chain: 'BTC', address: '1BHnp77MqZGGFaCGQ9J4GhLstPUeBshVcc', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Head of BTC cluster receiving laundered funds (Defendant Property 8).' },
				{ chain: 'BTC', address: 'bc1q9zlw8sp3qs3qtp9mswg68g073x65lm7v02ta5r', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: 'bc1qpnrkqlyznqdw4qpuzzpnqzknqsjxychct9dq7f', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '1DXbMUZwLea1jiYay1CaCNvYwR3chmVfvf', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Consolidation address (Defendant Property 23) receiving from multiple BTC clusters.' },
				{ chain: 'BTC', address: 'bc1qxsafg5y5tnt7w343tec8l4mehzwhkkqwzvv5yf', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'ETH', address: '0xeb0e94dcb4a8be477e11ca35b043be4b301f735e', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'ETH', address: '0x8bB65FB263585D04a139D4213CC6A96637FD1Fc5', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Defendant Property 170; received stolen USDT and ETH from the second (Exchange 10 / ALGO) hack chain.' },
				{ chain: 'ETH', address: '0x742B115424Ccda93d9228cA9aa56ec2442b94CA9', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '1LEvp3YQYERyuDSpV7bHAgqHaXhxDme59R', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Major consolidation cluster head (Defendant Property 172-280) for the Exchange 10 / ALGO theft laundering.' },
				{ chain: 'BTC', address: 'bc1q5gv9fjpxgqurzzekhnpqa6pnq98uhu0wumcnzh', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: 'bc1qhmv7k95xhca2x7h20yr7qmc0kvdfwqwlfs2cmv', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '1ANKiPsYo12uek8nKPermBTFEHK8tVcT22', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '1MfqK7q7YYYGnzCQpkkgwsr1vvGBpF4Gp4', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '1QGAGP93w4GjQGGCCqrjfCow9D9TcwYhs1', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high' },
				{ chain: 'BTC', address: '1A3ponnkRfe8x4yoFk7W68H4gcZtG4uoiP', role: 'laundering', ref: 'https://justice.gov/opa/press-release/file/1310421/dl', refType: 'law_enforcement', confidence: 'high', note: 'Last row (280) of Attachment A.' }
			]
		}
	],
	/** Researched, but no usable public address list (see `why`). */
	searched: [
		{ name: 'Harmony Horizon bridge hack', date: '2022-06-24', why: 'The FBI\'s attribution (2023-01-23) names no addresses on a fetchable page; one research lead was the FBI\'s 2023-08-22 DPRK list (already listed), not Harmony.' },
		{ name: 'AFX Trade bridge hack', date: '2026-07-23', why: 'Reported laundered through THORChain (655 ETH to 18.9 BTC), but no fetchable source prints the attacker address.' },
		{ name: 'CoinsPaid hack', date: '2023-07-22', why: 'CoinsPaid\'s post-mortem describes the attacker addresses without printing them; the FBI\'s 2023-08-22 BTC list (listed) covers its proceeds.' },
		{ name: 'Genesis-creditor social-engineering theft ($243M)', date: '2024-08-19', why: 'ZachXBT\'s tracing is published on X only (not fetched: its terms forbid automated access).' },
		{ name: '$330M BTC theft from an elderly holder', date: '2025-04-28', why: 'No fetchable source prints the addresses; laundering reported via exchanges and Monero.' },
		{ name: 'CrediX Finance exploit', date: '2025-08-04', why: 'The attacker address appears only on pages that refused automated fetches (theblock.co).' },
		{ name: 'Crypto.com hack', date: '2022-01-17', why: 'No attacker address on any fetchable source.' },
		{ name: 'Deribit hot-wallet hack', date: '2022-11-01', why: 'Deribit\'s report prints no addresses; news-cited strings could not be verified.' },
		{ name: 'BitKeep hack', date: '2022-12-26', why: 'The two consolidation addresses are not printed on any fetchable source.' },
		{ name: 'Harvest Finance exploit', date: '2020-10-26', why: 'Secondary sources print the attacker address inconsistently; the primary posts refused automated fetches.' },
		{ name: 'Mango Markets exploit', date: '2022-10-11', why: 'The court filings describe Solana program accounts, not attacker wallets.' },
		{ name: 'Upbit hot-wallet theft', date: '2019-11-27', why: 'Korean police confirmed the Lazarus attribution in 2024 without publishing addresses.' },
		{ name: 'Upbit Solana hot-wallet hack', date: '2025-11-27', why: 'Sources describe transfers to unnamed Solana wallets without printing them.' },
		{ name: 'Mixin Network hack', date: '2023-09-23', why: 'Post-mortems refer to exploiter addresses only through explorer links.' },
		{ name: 'PlayDapp exploit', date: '2024-02-09', why: 'Sources link only to explorer transaction pages.' },
		{ name: 'BtcTurk hot-wallet hack', date: '2024-06-22', why: 'The published address lists belong to the later August 2025 BtcTurk hack.' },
		{ name: 'Bunni V2 exploit', date: '2025-09-02', why: 'Only a truncated attacker address is printed.' },
		{ name: 'Shibarium bridge hack', date: '2025-09-12', why: 'Only a truncated attacker address is printed.' },
		{ name: 'UXLINK hack', date: '2025-09-22', why: 'No attacker address printed on the sources reviewed.' },
		{ name: 'Hyperdrive exploit', date: '2025-09-27', why: 'The consolidation address is not printed on the sources reviewed.' },
		{ name: 'Nemo Protocol exploit', date: '2025-09-08', why: 'The Ethereum destination address is not printed; the exploit itself was on Sui.' },
		{ name: 'CoinDCX hack', date: '2025-07-19', why: 'No attacker address on the sources reviewed (Halborn, Merkle Science, CoinDesk).' },
		{ name: 'Step Finance hack', date: '2026-01-31', why: 'Funds went to unnamed Solana addresses.' },
		{ name: 'SwapNet / Aperture Finance exploit', date: '2026-01-25', why: 'BlockSec\'s trace mixes contracts, victims and attacker hops without roles.' },
		{ name: 'Resolv Labs USR hack', date: '2026-03-22', why: 'No attacker wallet printed on the sources reviewed.' },
		{ name: 'Ostium exploit', date: '2026-07-15', why: 'Only truncated addresses are printed.' },
		{ name: 'Ronin bridge: three further OFAC addresses', date: '2022-04-22', why: 'The strings were found only on X; the ofac_sdn source lists them if they are designated.' }
	],
	clusters: [
		{
			id: 'bybit-2025',
			incident: 'bybit-2025',
			name: 'Bybit hack (TraderTraitor / DPRK), 2025-02-21',
			chain: 'ETH',
			entity: 'Bybit hack laundering cluster',
			ref: 'https://www.ic3.gov/PSA/2025/PSA250226',
			seedSources: ['fbi', 'ethlabels'],
			seedLabelFilter: 'Bybit Exploiter',
			window: { from: '2025-02-21T00:00:00Z', to: '2025-06-30T00:00:00Z' },
			minValue: 1,
			maxDepth: 3,
			maxAddresses: 25000,
			maxRequests: 12000,
			serviceTxThreshold: 1500,
			risk: 'high',
			priority: 0
		}
	]
};
