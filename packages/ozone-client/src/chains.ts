/**
 * Chain registry and address parsing for every chain THORChain pays out on
 * (THORNode 3.20.3: THOR, BTC, ETH, BSC, BASE, AVAX, GAIA, LTC, BCH, DOGE,
 * TRON, XRP, SOL) plus the extra chains that sanctions lists publish
 * addresses for (XMR, ZEC, DASH, BSV, BTG, XVG, ETC, ARB, BNB Beacon, ...).
 *
 * Every address is reduced to a canonical *key* `<namespace>:<address>`:
 *
 * - `evm:0x…`  lower-case hex; one namespace for all EVM chains (an EOA is
 *   the same key holder on ETH, BSC, BASE, AVAX, ARB, …).
 * - `btc:`, `ltc:`, `doge:` base58 kept as is (case-sensitive), bech32
 *   lower-cased (BIP-173 / BIP-350 checks, taproot included).
 * - `bch:` cashaddr *without* the `bitcoincash:` prefix, lower-cased — the
 *   form THORChain/Midgard use; legacy `1…`/`3…` BCH addresses convert to it.
 * - `tron:` base58check `T…` (hex `41…` / `0x…` forms convert to it).
 * - `thor:`, `gaia:`, `bnb:` bech32, lower-cased.
 * - `xrp:` classic `r…` address (XRP alphabet, checksum verified).
 * - `sol:` base58 that decodes to exactly 32 bytes.
 *
 * Checksums are always verified where the format has one, so a key is only
 * produced for a well-formed address.
 */
import {
	base58,
	base58checkDecode,
	base58checkEncode,
	base58Xrp,
	bech32Decode,
	bytesToHex,
	cashAddrDecode,
	cashAddrEncode,
	convertBits,
	hexToBytes,
	segwitDecode,
	segwitEncode
} from './encoding.js';

export type Namespace =
	| 'thor'
	| 'gaia'
	| 'btc'
	| 'ltc'
	| 'doge'
	| 'bch'
	| 'evm'
	| 'tron'
	| 'xrp'
	| 'sol'
	| 'bnb'
	| 'zec'
	| 'dash'
	| 'bsv'
	| 'btg'
	| 'xvg'
	| 'xmr';

export interface ChainInfo {
	code: string;
	name: string;
	namespace: Namespace;
	/** THORChain can send to / receive from this chain (THORNode 3.20.3). */
	thorchain: boolean;
}

const chain = (code: string, name: string, namespace: Namespace, thorchain = false): ChainInfo => ({
	code,
	name,
	namespace,
	thorchain
});

export const CHAINS: Readonly<Record<string, ChainInfo>> = Object.freeze({
	THOR: chain('THOR', 'THORChain', 'thor', true),
	BTC: chain('BTC', 'Bitcoin', 'btc', true),
	ETH: chain('ETH', 'Ethereum', 'evm', true),
	BSC: chain('BSC', 'BNB Smart Chain', 'evm', true),
	BASE: chain('BASE', 'Base', 'evm', true),
	AVAX: chain('AVAX', 'Avalanche C-Chain', 'evm', true),
	GAIA: chain('GAIA', 'Cosmos Hub', 'gaia', true),
	LTC: chain('LTC', 'Litecoin', 'ltc', true),
	BCH: chain('BCH', 'Bitcoin Cash', 'bch', true),
	DOGE: chain('DOGE', 'Dogecoin', 'doge', true),
	TRON: chain('TRON', 'TRON', 'tron', true),
	XRP: chain('XRP', 'XRP Ledger', 'xrp', true),
	SOL: chain('SOL', 'Solana', 'sol', true),
	// EVM chains that lists name but THORChain does not serve
	ARB: chain('ARB', 'Arbitrum', 'evm'),
	OP: chain('OP', 'Optimism', 'evm'),
	POL: chain('POL', 'Polygon', 'evm'),
	ETC: chain('ETC', 'Ethereum Classic', 'evm'),
	GNOSIS: chain('GNOSIS', 'Gnosis', 'evm'),
	CELO: chain('CELO', 'Celo', 'evm'),
	// Non-EVM chains with sanctioned addresses
	BNB: chain('BNB', 'BNB Beacon Chain', 'bnb'),
	XMR: chain('XMR', 'Monero', 'xmr'),
	ZEC: chain('ZEC', 'Zcash (transparent)', 'zec'),
	DASH: chain('DASH', 'Dash', 'dash'),
	BSV: chain('BSV', 'Bitcoin SV', 'bsv'),
	BTG: chain('BTG', 'Bitcoin Gold', 'btg'),
	XVG: chain('XVG', 'Verge', 'xvg')
});

/** The chains THORChain pays out on (THORNode 3.20.3), THORChain itself included. */
export const THORCHAIN_CHAINS: readonly string[] = Object.freeze(
	Object.values(CHAINS)
		.filter((c) => c.thorchain)
		.map((c) => c.code)
);

/** Every chain code this module can validate. */
export const SUPPORTED_CHAINS: readonly string[] = Object.freeze(Object.keys(CHAINS));

const CHAIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
	XBT: 'BTC',
	BITCOIN: 'BTC',
	ETHEREUM: 'ETH',
	TRX: 'TRON',
	USDT_TRON: 'TRON',
	TRC20: 'TRON',
	ERC20: 'ETH',
	BEP20: 'BSC',
	BINANCE: 'BSC',
	BINANCESMARTCHAIN: 'BSC',
	ARBITRUM: 'ARB',
	OPTIMISM: 'OP',
	MATIC: 'POL',
	POLYGON: 'POL',
	AVALANCHE: 'AVAX',
	ATOM: 'GAIA',
	COSMOS: 'GAIA',
	RUNE: 'THOR',
	THORCHAIN: 'THOR',
	LITECOIN: 'LTC',
	DOGECOIN: 'DOGE',
	BITCOINCASH: 'BCH',
	RIPPLE: 'XRP',
	SOLANA: 'SOL',
	MONERO: 'XMR',
	ZCASH: 'ZEC'
});

/**
 * Upper-cases and resolves aliases (`XBT` → `BTC`, `TRX` → `TRON`, …).
 * Token tickers (`USDT`, `USDC`) are not chains and return undefined: the
 * address format decides the chain.
 */
export function normalizeChain(value?: string | null): string | undefined {
	if (!value) return undefined;
	const up = value.trim().toUpperCase().replace(/[\s_-]+/g, '');
	if (!up) return undefined;
	if (CHAINS[up]) return up;
	if (CHAIN_ALIASES[up]) return CHAIN_ALIASES[up];
	return undefined;
}

export function chainInfo(code: string): ChainInfo | undefined {
	return CHAINS[code];
}

export interface ParsedAddress {
	/** Chain code (the hinted chain, or the family default when detected). */
	chain: string;
	namespace: Namespace;
	/** Canonical display form (see module docs). */
	address: string;
	/** Lookup key: `${namespace}:${address}`. */
	key: string;
	/** Script / account kind (p2pkh, p2sh, p2wpkh, p2wsh, p2tr, account, contract32, …). */
	kind: string;
	/** Public-key hash / account bytes, used to derive same-key twins. */
	hash?: Uint8Array;
}

const make = (
	chainCode: string,
	namespace: Namespace,
	address: string,
	kind: string,
	hash?: Uint8Array
): ParsedAddress => ({ chain: chainCode, namespace, address, key: `${namespace}:${address}`, kind, hash });

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

function parseEvm(input: string, chainCode: string): ParsedAddress | null {
	if (!EVM_RE.test(input)) return null;
	const lower = input.toLowerCase();
	return make(chainCode, 'evm', lower, 'account', hexToBytes(lower) ?? undefined);
}

function parseCosmos(input: string, hrp: string, chainCode: string, namespace: Namespace): ParsedAddress | null {
	const dec = bech32Decode(input, 128);
	if (!dec || dec.hrp !== hrp || dec.encoding !== 'bech32') return null;
	const bytes = convertBits(dec.words, 5, 8, false);
	if (!bytes || (bytes.length !== 20 && bytes.length !== 32)) return null;
	return make(
		chainCode,
		namespace,
		input.toLowerCase(),
		bytes.length === 20 ? 'account' : 'contract32',
		new Uint8Array(bytes)
	);
}

interface Base58Version {
	version: number;
	kind: 'p2pkh' | 'p2sh';
}

function parseBase58Versioned(
	input: string,
	chainCode: string,
	namespace: Namespace,
	versions: Base58Version[]
): ParsedAddress | null {
	if (input.length < 25 || input.length > 36) return null;
	const payload = base58checkDecode(input);
	if (!payload || payload.length !== 21) return null;
	const v = versions.find((x) => x.version === payload[0]);
	if (!v) return null;
	return make(chainCode, namespace, input, v.kind, payload.subarray(1));
}

function parseSegwit(input: string, hrp: string, chainCode: string, namespace: Namespace): ParsedAddress | null {
	const dec = segwitDecode(input, hrp);
	if (!dec) return null;
	let kind = 'witness';
	if (dec.version === 0 && dec.program.length === 20) kind = 'p2wpkh';
	else if (dec.version === 0 && dec.program.length === 32) kind = 'p2wsh';
	else if (dec.version === 1 && dec.program.length === 32) kind = 'p2tr';
	return make(chainCode, namespace, input.toLowerCase(), kind, dec.program);
}

function parseBtc(input: string, chainCode = 'BTC'): ParsedAddress | null {
	return (
		parseSegwit(input, 'bc', chainCode, 'btc') ??
		parseBase58Versioned(input, chainCode, 'btc', [
			{ version: 0x00, kind: 'p2pkh' },
			{ version: 0x05, kind: 'p2sh' }
		])
	);
}

function parseLtc(input: string): ParsedAddress | null {
	return (
		parseSegwit(input, 'ltc', 'LTC', 'ltc') ??
		parseBase58Versioned(input, 'LTC', 'ltc', [
			{ version: 0x30, kind: 'p2pkh' },
			{ version: 0x32, kind: 'p2sh' },
			{ version: 0x05, kind: 'p2sh' }
		])
	);
}

function parseDoge(input: string): ParsedAddress | null {
	return parseBase58Versioned(input, 'DOGE', 'doge', [
		{ version: 0x1e, kind: 'p2pkh' },
		{ version: 0x16, kind: 'p2sh' }
	]);
}

function parseBch(input: string): ParsedAddress | null {
	const trimmed = input.trim();
	// cashaddr, with or without the prefix
	if (/^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41,111}$/i.test(trimmed)) {
		const dec = cashAddrDecode(trimmed);
		if (!dec || dec.prefix !== 'bitcoincash' || dec.hash.length !== 20) return null;
		return make('BCH', 'bch', cashAddrEncode(dec.type, dec.hash), dec.type, dec.hash);
	}
	// legacy base58 (same format as BTC 1…/3…) converts to cashaddr
	const legacy = parseBase58Versioned(trimmed, 'BCH', 'bch', [
		{ version: 0x00, kind: 'p2pkh' },
		{ version: 0x05, kind: 'p2sh' }
	]);
	if (!legacy || !legacy.hash) return null;
	const kind = legacy.kind as 'p2pkh' | 'p2sh';
	return make('BCH', 'bch', cashAddrEncode(kind, legacy.hash), kind, legacy.hash);
}

function parseTron(input: string, allowHex: boolean): ParsedAddress | null {
	if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(input)) {
		const payload = base58checkDecode(input);
		if (!payload || payload.length !== 21 || payload[0] !== 0x41) return null;
		return make('TRON', 'tron', input, 'account', payload.subarray(1));
	}
	if (allowHex) {
		let hex: string | null = null;
		if (/^41[0-9a-fA-F]{40}$/.test(input)) hex = input.slice(2);
		else if (/^0x[0-9a-fA-F]{40}$/.test(input)) hex = input.slice(2);
		if (hex) {
			const bytes = hexToBytes(hex);
			if (!bytes) return null;
			const full = new Uint8Array(21);
			full[0] = 0x41;
			full.set(bytes, 1);
			return make('TRON', 'tron', base58checkEncode(full), 'account', bytes);
		}
	}
	return null;
}

function parseXrp(input: string): ParsedAddress | null {
	if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(input)) return null;
	const payload = base58checkDecode(input, base58Xrp);
	if (!payload || payload.length !== 21 || payload[0] !== 0x00) return null;
	return make('XRP', 'xrp', input, 'account', payload.subarray(1));
}

function parseSol(input: string): ParsedAddress | null {
	if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return null;
	const raw = base58.decode(input);
	if (!raw || raw.length !== 32) return null;
	return make('SOL', 'sol', input, 'account', raw);
}

function parseZec(input: string): ParsedAddress | null {
	if (!/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(input)) return null;
	const payload = base58checkDecode(input);
	if (!payload || payload.length !== 22 || payload[0] !== 0x1c) return null;
	if (payload[1] === 0xb8) return make('ZEC', 'zec', input, 'p2pkh', payload.subarray(2));
	if (payload[1] === 0xbd) return make('ZEC', 'zec', input, 'p2sh', payload.subarray(2));
	return null;
}

function parseXmr(input: string): ParsedAddress | null {
	// Monero uses its own block base58 with a Keccak checksum; format check only.
	if (!/^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(input) && !/^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(input)) return null;
	return make('XMR', 'xmr', input, input.length === 106 ? 'integrated' : input[0] === '8' ? 'subaddress' : 'standard');
}

/**
 * Parses `input` as an address of `chainCode` (already normalized). Returns
 * null when the string is not a valid address of that chain.
 */
export function parseForChain(input: string, chainCode: string): ParsedAddress | null {
	const s = input.trim();
	if (!s) return null;
	const info = CHAINS[chainCode];
	if (!info) return null;
	switch (info.namespace) {
		case 'evm':
			return parseEvm(s, chainCode);
		case 'thor':
			return parseCosmos(s, 'thor', 'THOR', 'thor');
		case 'gaia':
			return parseCosmos(s, 'cosmos', 'GAIA', 'gaia');
		case 'bnb':
			return parseCosmos(s, 'bnb', 'BNB', 'bnb');
		case 'btc':
			return parseBtc(s);
		case 'ltc':
			return parseLtc(s);
		case 'doge':
			return parseDoge(s);
		case 'bch':
			return parseBch(s);
		case 'tron':
			return parseTron(s, true);
		case 'xrp':
			return parseXrp(s);
		case 'sol':
			return parseSol(s);
		case 'zec':
			return parseZec(s);
		case 'xmr':
			return parseXmr(s);
		case 'dash':
			return parseBase58Versioned(s, 'DASH', 'dash', [
				{ version: 0x4c, kind: 'p2pkh' },
				{ version: 0x10, kind: 'p2sh' }
			]);
		case 'bsv':
			return parseBase58Versioned(s, 'BSV', 'bsv', [
				{ version: 0x00, kind: 'p2pkh' },
				{ version: 0x05, kind: 'p2sh' }
			]);
		case 'btg':
			return parseBase58Versioned(s, 'BTG', 'btg', [
				{ version: 0x26, kind: 'p2pkh' },
				{ version: 0x17, kind: 'p2sh' }
			]);
		case 'xvg':
			return parseBase58Versioned(s, 'XVG', 'xvg', [
				{ version: 0x1e, kind: 'p2pkh' },
				{ version: 0x21, kind: 'p2sh' }
			]);
	}
	return null;
}

/**
 * Every plausible reading of an address whose chain is unknown, most likely
 * first. A legacy `1…` string is a BTC address and also a BCH (legacy form)
 * and BSV address; all readings are returned so a lookup can check each.
 * Chains that share a format with a more common one (BSV, XVG) are only
 * returned as secondary readings.
 */
export function detectAddress(input: string): ParsedAddress[] {
	const s = input.trim();
	if (!s || s.length > 128 || /\s/.test(s)) return [];
	const out: ParsedAddress[] = [];
	const push = (p: ParsedAddress | null) => {
		if (p && !out.some((x) => x.key === p.key)) out.push(p);
	};

	if (EVM_RE.test(s)) {
		push(parseEvm(s, 'ETH'));
		return out;
	}
	const lower = s.toLowerCase();
	if (lower.startsWith('bitcoincash:')) {
		push(parseBch(s));
		return out;
	}
	if (lower.startsWith('thor1')) push(parseCosmos(s, 'thor', 'THOR', 'thor'));
	else if (lower.startsWith('cosmos1')) push(parseCosmos(s, 'cosmos', 'GAIA', 'gaia'));
	else if (lower.startsWith('bnb1')) push(parseCosmos(s, 'bnb', 'BNB', 'bnb'));
	else if (lower.startsWith('bc1')) push(parseSegwit(s, 'bc', 'BTC', 'btc'));
	else if (lower.startsWith('ltc1')) push(parseSegwit(s, 'ltc', 'LTC', 'ltc'));
	if (out.length) return out;

	if (/^[qp][02-9ac-hj-np-z]{41}$/i.test(s)) {
		push(parseBch(s));
		if (out.length) return out;
	}

	const payload = /^[1-9A-HJ-NP-Za-km-z]+$/.test(s) ? base58checkDecode(s) : null;
	if (payload && payload.length === 21) {
		switch (payload[0]) {
			case 0x00:
				push(parseBtc(s));
				push(parseBch(s));
				push(parseForChain(s, 'BSV'));
				break;
			case 0x05:
				push(parseBtc(s));
				push(parseBch(s));
				push(parseLtc(s));
				push(parseForChain(s, 'BSV'));
				break;
			case 0x30:
			case 0x32:
				push(parseLtc(s));
				break;
			case 0x1e:
				push(parseDoge(s));
				push(parseForChain(s, 'XVG'));
				break;
			case 0x16:
				push(parseDoge(s));
				break;
			case 0x41:
				push(parseTron(s, false));
				break;
			case 0x4c:
			case 0x10:
				push(parseForChain(s, 'DASH'));
				break;
			case 0x26:
			case 0x17:
				push(parseForChain(s, 'BTG'));
				break;
			case 0x21:
				push(parseForChain(s, 'XVG'));
				break;
		}
	} else if (payload && payload.length === 22) {
		push(parseZec(s));
	}
	if (out.length) return out;

	push(parseXrp(s));
	if (out.length) return out;
	push(parseSol(s));
	if (out.length) return out;
	push(parseXmr(s));
	return out;
}

/**
 * The readings of `input` a lookup should check. With a known chain hint the
 * address must be valid for that chain (an EVM hint accepts any 0x address);
 * without a hint every detected reading is returned.
 */
export function addressReadings(input: string, chainHint?: string | null): ParsedAddress[] {
	const chainCode = normalizeChain(chainHint);
	if (chainCode) {
		const p = parseForChain(input, chainCode);
		return p ? [p] : [];
	}
	return detectAddress(input);
}

/** Canonical key of an address, or null when it is not valid (for the hinted chain). */
export function canonicalKey(input: string, chainHint?: string | null): string | null {
	return addressReadings(input, chainHint)[0]?.key ?? null;
}

/**
 * Parses an address as published by a list that names a chain or ticker
 * (`XBT`, `USDT`, `ETH`, …). The declared chain is tried first; a token
 * ticker or a wrong declaration (lists do contain e.g. a TRON address under
 * `XBT`) falls back to format detection.
 */
export function parseListedAddress(
	raw: string,
	declared?: string | null
): { parsed: ParsedAddress; declaredMismatch: boolean } | null {
	const s = raw.trim();
	const chainCode = normalizeChain(declared);
	if (chainCode) {
		const p = parseForChain(s, chainCode);
		if (p) return { parsed: p, declaredMismatch: false };
	}
	const detected = detectAddress(s);
	if (!detected.length) return null;
	return { parsed: detected[0], declaredMismatch: Boolean(chainCode) };
}

/**
 * Addresses controlled by the same key on sibling chains:
 * TRON ↔ EVM (same 20-byte account hash) and pay-to-pubkey-hash across
 * BTC / BCH / LTC / DOGE (same hash160, legacy and native segwit forms).
 * Script hashes (P2SH/P2WSH/taproot) are not twinned.
 */
export function keyTwins(p: ParsedAddress): ParsedAddress[] {
	const out: ParsedAddress[] = [];
	const hash = p.hash;
	if (!hash) return out;
	if (p.namespace === 'tron' && hash.length === 20) {
		out.push(make('ETH', 'evm', '0x' + bytesToHex(hash), 'account', hash));
	} else if (p.namespace === 'evm' && hash.length === 20) {
		const full = new Uint8Array(21);
		full[0] = 0x41;
		full.set(hash, 1);
		out.push(make('TRON', 'tron', base58checkEncode(full), 'account', hash));
	} else if (hash.length === 20 && (p.kind === 'p2pkh' || p.kind === 'p2wpkh')) {
		const pkh = (version: number) => {
			const full = new Uint8Array(21);
			full[0] = version;
			full.set(hash, 1);
			return base58checkEncode(full);
		};
		const candidates: ParsedAddress[] = [
			make('BTC', 'btc', pkh(0x00), 'p2pkh', hash),
			make('BTC', 'btc', segwitEncode('bc', 0, hash), 'p2wpkh', hash),
			make('BCH', 'bch', cashAddrEncode('p2pkh', hash), 'p2pkh', hash),
			make('LTC', 'ltc', pkh(0x30), 'p2pkh', hash),
			make('LTC', 'ltc', segwitEncode('ltc', 0, hash), 'p2wpkh', hash),
			make('DOGE', 'doge', pkh(0x1e), 'p2pkh', hash)
		];
		if (['btc', 'bch', 'ltc', 'doge'].includes(p.namespace)) {
			for (const c of candidates) if (c.key !== p.key) out.push(c);
		}
	}
	return out;
}

/** Splits a key into namespace and address. */
export function splitKey(key: string): { namespace: string; address: string } | null {
	const i = key.indexOf(':');
	if (i <= 0) return null;
	return { namespace: key.slice(0, i), address: key.slice(i + 1) };
}

/** Chains whose addresses live in a namespace (for display / coverage checks). */
export function chainsOfNamespace(ns: string): string[] {
	return Object.values(CHAINS)
		.filter((c) => c.namespace === ns)
		.map((c) => c.code);
}
