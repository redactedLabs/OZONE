import { keccak_256 } from '@noble/hashes/sha3';

/** EIP-55 mixed-case checksum form of a 0x address. */
export function toChecksumAddress(address: string): string {
	const lower = address.toLowerCase().replace(/^0x/, '');
	if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error('not an EVM address');
	const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
	let out = '0x';
	for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
	return out;
}

export function keccakHex(text: string): string {
	return '0x' + Buffer.from(keccak_256(new TextEncoder().encode(text))).toString('hex');
}

/** 0x + last 20 bytes of a 32-byte topic / word. */
export function wordToAddress(word: string): string {
	const w = word.startsWith('0x') ? word.slice(2) : word;
	return '0x' + w.slice(-40).toLowerCase();
}

/** Decodes `address[]` ABI data (a single dynamic array argument). */
export function decodeAddressArray(data: string): string[] {
	const hex = data.startsWith('0x') ? data.slice(2) : data;
	if (hex.length < 128) return [];
	const offset = parseInt(hex.slice(0, 64), 16) * 2;
	const len = parseInt(hex.slice(offset, offset + 64), 16);
	if (!Number.isSafeInteger(len) || len < 0 || len > 100_000) return [];
	const out: string[] = [];
	for (let i = 0; i < len; i++) {
		const start = offset + 64 + i * 64;
		const word = hex.slice(start, start + 64);
		if (word.length !== 64) break;
		out.push(wordToAddress(word));
	}
	return out;
}
