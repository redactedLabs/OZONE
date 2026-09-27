/**
 * Community-maintained lists:
 *
 * - eth-labels (dawsbot/eth-labels, scraped Etherscan labels): only labels
 *   that name an attacker are imported (exploiters, heists, phishing).
 *   Deliberately excluded: `ofac-*` and `tornado-cash` (stale — Tornado Cash
 *   was delisted by OFAC on 2025-03-21; OFAC itself is the source of truth),
 *   `cpimp-attack` (these are the *compromised victims*), `blocked` (null
 *   and precompile addresses).
 * - ScamSniffer scam-database: phishing / wallet-drainer addresses.
 */
import type { Category, Risk } from '../../../ozone-client/src/index.js';
import { parseForChain } from '../../../ozone-client/src/index.js';
import { emptyResult, type ParseResult } from '../types.js';

export const ETH_LABELS_URL = 'https://raw.githubusercontent.com/dawsbot/eth-labels/v1/data/json/accounts.json';
export const SCAMSNIFFER_URL = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';

interface LabelPolicy {
	category: Category;
	risk: Risk;
	code: string;
}

const EXPLOIT: LabelPolicy = { category: 'exploit', risk: 'high', code: 'EXPLOITER_LABEL' };
const PHISH: LabelPolicy = { category: 'phishing', risk: 'medium', code: 'PHISHING_LABEL' };

export const ETH_LABEL_POLICY: Readonly<Record<string, LabelPolicy | null>> = Object.freeze({
	'bybit-exploit': { category: 'hack', risk: 'high', code: 'HACK_LABEL' },
	'wazirx-exploit': { category: 'hack', risk: 'high', code: 'HACK_LABEL' },
	'bingx-exploit': { category: 'hack', risk: 'high', code: 'HACK_LABEL' },
	'radiant-capital-exploit': { category: 'hack', risk: 'high', code: 'HACK_LABEL' },
	exploit: EXPLOIT,
	heist: EXPLOIT,
	'filament-exploit': EXPLOIT,
	'truebit-exploit': EXPLOIT,
	'unibtc-exploit': EXPLOIT,
	'zkswap-exploit': EXPLOIT,
	'onyxdao-exploit': EXPLOIT,
	'phish-hack': PHISH,
	scam: { category: 'scam', risk: 'medium', code: 'SCAM_LABEL' },
	// deliberately not imported
	'ofac-sanctioned': null,
	'ofac-sanctions-lists': null,
	'tornado-cash': null,
	'cpimp-attack': null,
	blocked: null
});

/**
 * eth-labels files each newly labelled heist under its own slug
 * (`bybit-exploit`, `wazirx-exploit`, …). A slug that is not in the table
 * above but names an attack — `<incident>-exploit`, `-exploiter`, `-hack`,
 * `-hacker`, `-heist` — is imported as a hack attribution, so a new incident
 * reaches Ozone with the next daily sync instead of after a code change.
 * Entries whose name tag marks a victim (compromised, exploited contract)
 * are skipped.
 */
const NEW_INCIDENT_SLUG = /^[a-z0-9][a-z0-9-]*-(exploit|exploiter|hack|hacker|heist)$/;
const VICTIM_TAG = /compromised|exploited|victim|drained wallet/i;
const NEW_INCIDENT: LabelPolicy = { category: 'hack', risk: 'high', code: 'HACK_LABEL' };

function policyFor(label: string, nameTag: string): LabelPolicy | null | undefined {
	const explicit = ETH_LABEL_POLICY[label];
	if (explicit !== undefined) return explicit;
	if (!NEW_INCIDENT_SLUG.test(label)) return undefined;
	return VICTIM_TAG.test(nameTag) ? null : NEW_INCIDENT;
}

const CHAIN_BY_ID: Record<number, { chain: string; explorer: string }> = {
	1: { chain: 'ETH', explorer: 'https://etherscan.io/address/' },
	56: { chain: 'BSC', explorer: 'https://bscscan.com/address/' },
	10: { chain: 'OP', explorer: 'https://optimistic.etherscan.io/address/' },
	8453: { chain: 'BASE', explorer: 'https://basescan.org/address/' },
	42161: { chain: 'ARB', explorer: 'https://arbiscan.io/address/' },
	100: { chain: 'GNOSIS', explorer: 'https://gnosisscan.io/address/' },
	42220: { chain: 'CELO', explorer: 'https://celoscan.io/address/' },
	43114: { chain: 'AVAX', explorer: 'https://snowtrace.io/address/' },
	137: { chain: 'POL', explorer: 'https://polygonscan.com/address/' }
};

interface EthLabel {
	address: string;
	chainId: number;
	label: string;
	nameTag?: string | null;
}

export function parseEthLabels(json: unknown, version?: string): ParseResult {
	const res = emptyResult();
	res.version = version;
	if (!Array.isArray(json)) throw new Error('eth-labels: expected an array');
	const byKey = new Map<string, ParseResult['entries'][number]>();
	const skippedLabels = new Map<string, number>();
	const newSlugs = new Map<string, number>();
	for (const raw of json as EthLabel[]) {
		if (!raw || typeof raw.address !== 'string' || typeof raw.label !== 'string') continue;
		const name = (raw.nameTag ?? '').trim();
		let policy = policyFor(raw.label, name);
		if (policy === undefined) continue; // unrelated label (exchanges, protocols, …)
		if (policy === null) {
			skippedLabels.set(raw.label, (skippedLabels.get(raw.label) ?? 0) + 1);
			continue;
		}
		if (!(raw.label in ETH_LABEL_POLICY)) newSlugs.set(raw.label, (newSlugs.get(raw.label) ?? 0) + 1);
		if (/^fake_phishing/i.test(name)) policy = PHISH;
		const chainInfo = CHAIN_BY_ID[raw.chainId] ?? CHAIN_BY_ID[1];
		const p = parseForChain(raw.address, chainInfo.chain);
		if (!p) {
			res.rejected.push({ raw: raw.address, declared: String(raw.chainId), context: raw.label });
			continue;
		}
		if (p.address === '0x0000000000000000000000000000000000000000') continue;
		const existing = byKey.get(p.key);
		// keep the strongest label per address
		if (existing && (existing.risk === 'high' || policy.risk !== 'high')) continue;
		byKey.set(p.key, {
			source: 'ethlabels',
			key: p.key,
			chain: chainInfo.chain,
			address: p.address,
			category: policy.category,
			risk: policy.risk,
			code: policy.code,
			entity: name || raw.label,
			text: `Etherscan label "${name || raw.label}" (${raw.label}, via eth-labels)`,
			refUrl: chainInfo.explorer + p.address,
			refId: `${raw.chainId}:${raw.label}`,
			meta: { label: raw.label, chainId: raw.chainId }
		});
	}
	for (const [label, n] of skippedLabels) res.notes.push(`skipped ${n} entries labelled ${label}`);
	for (const [label, n] of newSlugs) res.notes.push(`imported ${n} entries of the new incident label ${label}`);
	res.entries = [...byKey.values()];
	return res;
}

export function parseScamSniffer(json: unknown, version?: string): ParseResult {
	const res = emptyResult();
	res.version = version;
	if (!Array.isArray(json)) throw new Error('ScamSniffer: expected an array');
	const seen = new Set<string>();
	for (const raw of json) {
		if (typeof raw !== 'string') continue;
		const p = parseForChain(raw.trim(), 'ETH');
		if (!p) {
			res.rejected.push({ raw: String(raw).slice(0, 80) });
			continue;
		}
		if (seen.has(p.key)) continue;
		seen.add(p.key);
		res.entries.push({
			source: 'scamsniffer',
			key: p.key,
			chain: 'ETH',
			address: p.address,
			category: 'phishing',
			risk: 'medium',
			code: 'SCAMSNIFFER',
			entity: 'Phishing / wallet drainer',
			text: 'Reported phishing or wallet-drainer address (ScamSniffer scam-database)',
			refUrl: 'https://github.com/scamsniffer/scam-database',
			refId: 'scamsniffer'
		});
	}
	return res;
}
