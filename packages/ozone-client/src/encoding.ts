/**
 * Address encodings used by the chains Ozone screens: base58 / base58check
 * (Bitcoin and XRP alphabets), bech32 / bech32m (BIP-173 / BIP-350) and
 * Bitcoin Cash cashaddr. Dependency-free; only `node:crypto` for SHA-256.
 */
import { createHash } from 'node:crypto';

export const BTC_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const XRP_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

export function sha256(data: Uint8Array): Uint8Array {
	return new Uint8Array(createHash('sha256').update(data).digest());
}

export function sha256Hex(data: Uint8Array | string): string {
	return createHash('sha256').update(data).digest('hex');
}

export function bytesToHex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

export function hexToBytes(hex: string): Uint8Array | null {
	const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

export interface Base58Codec {
	decode(s: string): Uint8Array | null;
	encode(data: Uint8Array): string;
}

function makeBase58(alphabet: string): Base58Codec {
	const map = new Int16Array(128).fill(-1);
	for (let i = 0; i < alphabet.length; i++) map[alphabet.charCodeAt(i)] = i;
	const leader = alphabet[0];
	return {
		decode(s: string): Uint8Array | null {
			if (s.length === 0 || s.length > 256) return null;
			let zeros = 0;
			while (zeros < s.length && s[zeros] === leader) zeros++;
			const bytes: number[] = []; // little-endian base-256 accumulator
			for (let i = zeros; i < s.length; i++) {
				const code = s.charCodeAt(i);
				if (code >= 128) return null;
				let carry = map[code];
				if (carry < 0) return null;
				for (let j = 0; j < bytes.length; j++) {
					carry += bytes[j] * 58;
					bytes[j] = carry & 0xff;
					carry >>= 8;
				}
				while (carry > 0) {
					bytes.push(carry & 0xff);
					carry >>= 8;
				}
			}
			const out = new Uint8Array(zeros + bytes.length);
			for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
			return out;
		},
		encode(data: Uint8Array): string {
			let zeros = 0;
			while (zeros < data.length && data[zeros] === 0) zeros++;
			const digits: number[] = [];
			for (let i = zeros; i < data.length; i++) {
				let carry = data[i];
				for (let j = 0; j < digits.length; j++) {
					carry += digits[j] << 8;
					digits[j] = carry % 58;
					carry = (carry / 58) | 0;
				}
				while (carry > 0) {
					digits.push(carry % 58);
					carry = (carry / 58) | 0;
				}
			}
			let s = leader.repeat(zeros);
			for (let i = digits.length - 1; i >= 0; i--) s += alphabet[digits[i]];
			return s;
		}
	};
}

export const base58 = makeBase58(BTC_ALPHABET);
export const base58Xrp = makeBase58(XRP_ALPHABET);

function checksum4(payload: Uint8Array): Uint8Array {
	return sha256(sha256(payload)).subarray(0, 4);
}

/** Decodes base58check; returns the payload (version byte(s) included) or null. */
export function base58checkDecode(s: string, codec: Base58Codec = base58): Uint8Array | null {
	const raw = codec.decode(s);
	if (!raw || raw.length < 5) return null;
	const payload = raw.subarray(0, raw.length - 4);
	const check = raw.subarray(raw.length - 4);
	return bytesEqual(checksum4(payload), check) ? new Uint8Array(payload) : null;
}

export function base58checkEncode(payload: Uint8Array, codec: Base58Codec = base58): string {
	const out = new Uint8Array(payload.length + 4);
	out.set(payload, 0);
	out.set(checksum4(payload), payload.length);
	return codec.encode(out);
}

// ---------------------------------------------------------------------------
// bech32 / bech32m
// ---------------------------------------------------------------------------

export const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
	let chk = 1;
	for (const v of values) {
		const top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i];
	}
	return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
	out.push(0);
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
	return out;
}

export interface Bech32Decoded {
	hrp: string;
	words: number[];
	encoding: 'bech32' | 'bech32m';
}

/** Decodes bech32 or bech32m. Mixed case is invalid; the result is lower case. */
export function bech32Decode(input: string, limit = 128): Bech32Decoded | null {
	if (input.length < 8 || input.length > limit) return null;
	if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;
	const s = input.toLowerCase();
	const pos = s.lastIndexOf('1');
	if (pos < 1 || pos + 7 > s.length) return null;
	const hrp = s.slice(0, pos);
	for (let i = 0; i < hrp.length; i++) {
		const c = hrp.charCodeAt(i);
		if (c < 33 || c > 126) return null;
	}
	const data: number[] = [];
	for (let i = pos + 1; i < s.length; i++) {
		const d = BECH32_CHARSET.indexOf(s[i]);
		if (d < 0) return null;
		data.push(d);
	}
	const pm = bech32Polymod([...hrpExpand(hrp), ...data]);
	let encoding: 'bech32' | 'bech32m';
	if (pm === 1) encoding = 'bech32';
	else if (pm === BECH32M_CONST) encoding = 'bech32m';
	else return null;
	return { hrp, words: data.slice(0, data.length - 6), encoding };
}

export function bech32Encode(hrp: string, words: number[], encoding: 'bech32' | 'bech32m' = 'bech32'): string {
	const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
	const mod = bech32Polymod(values) ^ (encoding === 'bech32' ? 1 : BECH32M_CONST);
	let out = hrp + '1';
	for (const w of words) out += BECH32_CHARSET[w];
	for (let i = 0; i < 6; i++) out += BECH32_CHARSET[(mod >>> (5 * (5 - i))) & 31];
	return out;
}

/** Regroups bits (e.g. 5-bit words to bytes). Returns null on invalid padding. */
export function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
	let acc = 0;
	let bits = 0;
	const out: number[] = [];
	const maxv = (1 << to) - 1;
	for (let i = 0; i < data.length; i++) {
		const value = data[i];
		if (value < 0 || value >> from !== 0) return null;
		acc = (acc << from) | value;
		bits += from;
		while (bits >= to) {
			bits -= to;
			out.push((acc >> bits) & maxv);
		}
		acc &= (1 << bits) - 1; // keep only unconsumed bits (avoids overflow)
	}
	if (pad) {
		if (bits > 0) out.push((acc << (to - bits)) & maxv);
	} else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
		return null;
	}
	return out;
}

export interface SegwitDecoded {
	hrp: string;
	version: number;
	program: Uint8Array;
}

/** BIP-173/BIP-350 segwit address decoding with all consensus-level checks. */
export function segwitDecode(address: string, expectedHrp: string): SegwitDecoded | null {
	const dec = bech32Decode(address, 90);
	if (!dec || dec.hrp !== expectedHrp || dec.words.length < 1) return null;
	const version = dec.words[0];
	if (version > 16) return null;
	const program = convertBits(dec.words.slice(1), 5, 8, false);
	if (!program || program.length < 2 || program.length > 40) return null;
	if (version === 0 && program.length !== 20 && program.length !== 32) return null;
	if (version === 0 && dec.encoding !== 'bech32') return null;
	if (version !== 0 && dec.encoding !== 'bech32m') return null;
	return { hrp: dec.hrp, version, program: new Uint8Array(program) };
}

export function segwitEncode(hrp: string, version: number, program: Uint8Array): string {
	const words = convertBits(program, 8, 5, true) ?? [];
	return bech32Encode(hrp, [version, ...words], version === 0 ? 'bech32' : 'bech32m');
}

// ---------------------------------------------------------------------------
// Bitcoin Cash cashaddr
// ---------------------------------------------------------------------------

const CASH_GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

function cashPolymod(values: number[]): bigint {
	let c = 1n;
	for (const d of values) {
		const c0 = c >> 35n;
		c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
		for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= CASH_GEN[i];
	}
	return c ^ 1n;
}

function cashPrefixExpand(prefix: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < prefix.length; i++) out.push(prefix.charCodeAt(i) & 0x1f);
	out.push(0);
	return out;
}

export interface CashAddrDecoded {
	prefix: string;
	type: 'p2pkh' | 'p2sh';
	hash: Uint8Array;
}

/** Decodes a cashaddr with or without its prefix (default `bitcoincash`). */
export function cashAddrDecode(input: string, defaultPrefix = 'bitcoincash'): CashAddrDecoded | null {
	if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;
	const s = input.toLowerCase();
	let prefix = defaultPrefix;
	let payloadStr = s;
	const colon = s.indexOf(':');
	if (colon >= 0) {
		prefix = s.slice(0, colon);
		payloadStr = s.slice(colon + 1);
	}
	if (payloadStr.length < 42 || payloadStr.length > 112) return null;
	const data: number[] = [];
	for (const ch of payloadStr) {
		const d = BECH32_CHARSET.indexOf(ch);
		if (d < 0) return null;
		data.push(d);
	}
	if (cashPolymod([...cashPrefixExpand(prefix), ...data]) !== 0n) return null;
	const bytes = convertBits(data.slice(0, data.length - 8), 5, 8, false);
	if (!bytes || bytes.length < 21) return null;
	const versionByte = bytes[0];
	const typeBits = (versionByte >> 3) & 0x0f;
	const sizeBits = versionByte & 0x07;
	const sizes = [20, 24, 28, 32, 40, 48, 56, 64];
	const hash = new Uint8Array(bytes.slice(1));
	if (hash.length !== sizes[sizeBits]) return null;
	if (typeBits !== 0 && typeBits !== 1) return null;
	return { prefix, type: typeBits === 0 ? 'p2pkh' : 'p2sh', hash };
}

/** Encodes a cashaddr (without the prefix in the returned string unless `withPrefix`). */
export function cashAddrEncode(
	type: 'p2pkh' | 'p2sh',
	hash: Uint8Array,
	prefix = 'bitcoincash',
	withPrefix = false
): string {
	const sizes = [20, 24, 28, 32, 40, 48, 56, 64];
	const sizeBits = sizes.indexOf(hash.length);
	if (sizeBits < 0) throw new Error('invalid cashaddr hash length');
	const versionByte = ((type === 'p2pkh' ? 0 : 1) << 3) | sizeBits;
	const payload = convertBits([versionByte, ...hash], 8, 5, true) ?? [];
	const mod = cashPolymod([...cashPrefixExpand(prefix), ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
	let body = '';
	for (const p of payload) body += BECH32_CHARSET[p];
	for (let i = 0; i < 8; i++) body += BECH32_CHARSET[Number((mod >> BigInt(5 * (7 - i))) & 31n)];
	return withPrefix ? `${prefix}:${body}` : body;
}
