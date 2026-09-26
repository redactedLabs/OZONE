/**
 * Curated, individually verified attributions that no machine-readable
 * source publishes (e.g. FBI press releases on fbi.gov, which blocks
 * automated fetches), plus the hack clusters Ozone expands on-chain.
 *
 * Contributing: add an incident only with a public primary source in `ref`
 * and say in `verification` how it was checked. Addresses are validated
 * (checksums) at import; an invalid address fails the sync loudly.
 */
import type { Category, Risk } from '../../../ozone-client/src/index.js';

export interface CuratedIncident {
	id: string;
	name: string;
	category: Category;
	risk: Risk;
	code: string;
	date: string;
	entity: string;
	text: string;
	ref: string;
	verification: string;
	addresses: Array<{ chain: string; address: string }>;
}

export interface ClusterSpec {
	id: string;
	name: string;
	chain: 'ETH';
	entity: string;
	ref: string;
	/** Sources whose addresses seed the expansion. */
	seedSources: string[];
	/** Only seeds whose entity contains this text (for broad sources such as eth-labels). */
	seedLabelFilter?: string;
	window: { from: string; to: string };
	minValueEth: number;
	maxDepth: number;
	maxAddresses: number;
	/** Addresses with more transactions than this are services (exchanges, bridges): never expanded or listed. */
	serviceTxThreshold: number;
	risk: Risk;
}

export interface CuratedData {
	version: string;
	policy: string;
	incidents: CuratedIncident[];
	clusters: ClusterSpec[];
}

export const CURATED: CuratedData = {
	"version": "2026-09-27",
	"policy": "Only addresses whose attribution can be checked against a public primary source (law-enforcement publication, explorer label) are admitted. Each entry names that source. The previous hard-coded hack list was dropped: of its 21 addresses only 4 could be confirmed (Bybit Exploiter 1, the OFAC-listed Ronin exploiter and Lazarus address, the KuCoin hacker); 13 matched no public attribution, one is labelled for a different incident (Wintermute exploiter, listed as Ronin) and three are not valid addresses at all (failed checksums / a corrupted string).",
	"incidents": [
		{
			"id": "fbi-dprk-2023-08-22",
			"name": "DPRK (Lazarus / TraderTraitor) — FBI 2023-08-22",
			"category": "law_enforcement",
			"risk": "severe",
			"code": "FBI_DPRK",
			"date": "2023-08-22",
			"entity": "TraderTraitor (DPRK / Lazarus Group)",
			"text": "FBI (2023-08-22): bitcoin address holding funds stolen by DPRK cyber actors (Atomic Wallet, Alphapo, CoinsPaid, Stake heists)",
			"ref": "https://www.fbi.gov/news/press-releases/fbi-identifies-cryptocurrency-funds-stolen-by-dprk",
			"verification": "fbi.gov blocks automated fetches; addresses are checksum-valid and their on-chain history (≈1,580 BTC received in total) matches the amount the FBI named. Verified 2026-09-27.",
			"addresses": [
				{
					"chain": "BTC",
					"address": "3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG"
				},
				{
					"chain": "BTC",
					"address": "39idqitN9tYNmq3wYanwg3MitFB5TZCjWu"
				},
				{
					"chain": "BTC",
					"address": "3AAUBbKJorvNhEUFhKnep9YTwmZECxE4Nk"
				},
				{
					"chain": "BTC",
					"address": "3PjNaSeP8GzLjGeu51JR19Q2Lu8W2Te9oc"
				},
				{
					"chain": "BTC",
					"address": "3NbdrezMzAVVfXv5MTQJn4hWqKhYCTCJoB"
				},
				{
					"chain": "BTC",
					"address": "34VXKa5upLWVYMXmgid6bFM4BaQXHxSUoL"
				}
			]
		},
		{
			"id": "kucoin-2020",
			"name": "KuCoin hack (2020-09-26, attributed to Lazarus Group)",
			"category": "hack",
			"risk": "high",
			"code": "HACK_CURATED",
			"date": "2020-09-26",
			"entity": "KuCoin Hacker",
			"text": "Etherscan-labelled \"KuCoin Hacker\" address (KuCoin hot-wallet theft, Sept 2020)",
			"ref": "https://etherscan.io/address/0xeb31973e0febf3e3d7058234a5ebbae1ab4b8c23",
			"verification": "Etherscan label \"Kucoin Hacker\" (present in the eth-labels dump under the non-imported `blocked` label).",
			"addresses": [
				{
					"chain": "ETH",
					"address": "0xeb31973e0febf3e3d7058234a5ebbae1ab4b8c23"
				}
			]
		}
	],
	"clusters": [
		{
			"id": "bybit-2025",
			"name": "Bybit hack (TraderTraitor / DPRK), 2025-02-21",
			"chain": "ETH",
			"entity": "Bybit hack laundering cluster",
			"ref": "https://www.ic3.gov/PSA/2025/PSA250226",
			"seedSources": [
				"fbi",
				"ethlabels"
			],
			"seedLabelFilter": "Bybit Exploiter",
			"window": {
				"from": "2025-02-21T00:00:00Z",
				"to": "2025-06-30T00:00:00Z"
			},
			"minValueEth": 1,
			"maxDepth": 3,
			"maxAddresses": 25000,
			"serviceTxThreshold": 1500,
			"risk": "high"
		}
	]
};
