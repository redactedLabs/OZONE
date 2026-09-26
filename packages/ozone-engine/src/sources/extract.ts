/**
 * Extracts crypto addresses from free text (UK "OtherInformation", EU
 * remarks, press releases). Every candidate must pass the full checksum
 * validation of its chain. Formats without a checksum (Solana, Monero) are
 * only accepted when the text labels them explicitly, so identifiers that
 * happen to be valid base58 are never imported.
 *
 * Official texts contain typing artefacts such as an address split by a
 * space ("TNZxGWCwvsHr6JxQxzoeDXV5 97Yf7Zb7nV"); adjacent fragments are
 * joined when — and only when — the joined string validates.
 */
import { detectAddress, normalizeChain, parseForChain, type ParsedAddress } from '../../../ozone-client/src/index.js';

export interface ExtractedAddress {
	raw: string;
	parsed: ParsedAddress;
	/** Chain label found right before the address (e.g. `ETH:`, `XBT`, `USDT:`). */
	label?: string;
	/** Two fragments were joined to form the address. */
	joined?: boolean;
}

const LABELS = new Set([
	'BTC', 'XBT', 'ETH', 'USDT', 'USDC', 'TRX', 'TRON', 'BSC', 'BNB', 'BEP20', 'ERC20', 'TRC20', 'LTC', 'BCH',
	'DOGE', 'XRP', 'SOL', 'XMR', 'ZEC', 'DASH', 'ETC', 'ARB', 'MATIC', 'POL', 'AVAX', 'BASE', 'TON', 'ADA'
]);

const NO_CHECKSUM = new Set(['sol', 'xmr']);

function cleanToken(t: string): string {
	return t.replace(/^[("'[{<]+/, '').replace(/[)"'\]}>.,;:]+$/, '');
}

function labelOf(token: string): string | undefined {
	const up = token.replace(/[():,;.\-]/g, '').toUpperCase();
	return LABELS.has(up) ? up : undefined;
}

function tryParse(candidate: string, label?: string): ParsedAddress | null {
	if (candidate.length < 25 || candidate.length > 128) return null;
	const labelChain = label ? normalizeChain(label === 'BNB' && candidate.startsWith('0x') ? 'BSC' : label) : undefined;
	if (labelChain) {
		const p = parseForChain(candidate, labelChain);
		if (p) return p;
	}
	const detected = detectAddress(candidate).filter(
		(p) => !NO_CHECKSUM.has(p.namespace) || (labelChain !== undefined && p.chain === labelChain)
	);
	return detected[0] ?? null;
}

export function extractAddresses(text: string): ExtractedAddress[] {
	const out: ExtractedAddress[] = [];
	const seen = new Set<string>();
	// Split into tokens; keep "LABEL:address" together for the check below.
	const tokens = text.split(/[\s,;|]+/).filter(Boolean);
	let pendingLabel: { label: string; distance: number } | undefined;
	for (let i = 0; i < tokens.length; i++) {
		let tok = cleanToken(tokens[i]);
		if (!tok) continue;
		// "ETH:0xabc…" or "USDT:T…" glued together
		const colon = tok.indexOf(':');
		if (colon > 0 && colon < 8 && !tok.toLowerCase().startsWith('bitcoincash:')) {
			const maybeLabel = labelOf(tok.slice(0, colon));
			if (maybeLabel) {
				pendingLabel = { label: maybeLabel, distance: 0 };
				tok = tok.slice(colon + 1);
				if (!tok) continue;
			}
		}
		const lab = labelOf(tok);
		if (lab && tok.length <= 6) {
			pendingLabel = { label: lab, distance: 0 };
			continue;
		}
		const label = pendingLabel && pendingLabel.distance <= 3 ? pendingLabel.label : undefined;
		let parsed = tryParse(tok, label);
		let raw = tok;
		let joined = false;
		if (!parsed && i + 1 < tokens.length && /^[A-Za-z0-9]{8,}$/.test(tok)) {
			const next = cleanToken(tokens[i + 1]);
			if (/^[A-Za-z0-9]{2,}$/.test(next)) {
				const cand = tok + next;
				const p = tryParse(cand, label);
				if (p) {
					parsed = p;
					raw = cand;
					joined = true;
					i++;
				}
			}
		}
		if (parsed) {
			if (!seen.has(parsed.key)) {
				seen.add(parsed.key);
				out.push({ raw, parsed, ...(label ? { label } : {}), ...(joined ? { joined } : {}) });
			}
			// a label applies to the addresses that follow it ("BTC: a b c")
			if (pendingLabel) pendingLabel.distance = 0;
		} else if (pendingLabel) {
			pendingLabel.distance++;
		}
	}
	return out;
}
