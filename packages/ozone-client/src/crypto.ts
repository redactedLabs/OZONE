/**
 * Ed25519 signing and verification over canonical JSON with domain
 * separation: the signed bytes are `<domain>\n<canonicalJson(payload)>`.
 * Uses `node:crypto` only (Node 18+).
 */
import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign as nodeSign,
	verify as nodeVerify,
	type KeyObject
} from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { bytesToHex, hexToBytes, sha256Hex } from './encoding.js';

export const DOMAIN_SNAPSHOT_MANIFEST = 'ozone.snapshot.manifest.v1';
export const DOMAIN_SCREEN_RESPONSE = 'ozone.screen.response.v1';
export const DOMAIN_CERTIFICATE = 'ozone.certificate.v1';

const SPKI_PREFIX = hexToBytes('302a300506032b6570032100')!;
const PKCS8_PREFIX = hexToBytes('302e020100300506032b657004220420')!;

export interface PublicKeyInfo {
	/** Short identifier: `oz` + first 16 hex chars of SHA-256(raw public key). */
	keyId: string;
	raw: Uint8Array;
	key: KeyObject;
	/** `ed25519:<base64 raw key>` — the form to pin in configuration. */
	spec: string;
}

export interface PrivateKeyInfo {
	key: KeyObject;
	publicKey: PublicKeyInfo;
}

function decodeKeyMaterial(text: string): Uint8Array | null {
	const t = text.trim();
	if (/^[0-9a-fA-F]{64}$/.test(t)) return hexToBytes(t);
	if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) {
		const b = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
		return new Uint8Array(b);
	}
	return null;
}

export function keyIdOf(raw: Uint8Array): string {
	return 'oz' + sha256Hex(raw).slice(0, 16);
}

export function publicKeyFromRaw(raw: Uint8Array): PublicKeyInfo {
	if (raw.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
	const der = new Uint8Array(SPKI_PREFIX.length + 32);
	der.set(SPKI_PREFIX, 0);
	der.set(raw, SPKI_PREFIX.length);
	const key = createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
	return { keyId: keyIdOf(raw), raw, key, spec: 'ed25519:' + Buffer.from(raw).toString('base64') };
}

/**
 * Parses a pinned public key: `ed25519:<base64|base64url|hex>`, a bare
 * 32-byte base64/hex string, or an SPKI PEM.
 */
export function parsePublicKey(spec: string): PublicKeyInfo {
	const s = spec.trim();
	if (s.startsWith('-----BEGIN')) {
		const key = createPublicKey(s);
		const der = key.export({ format: 'der', type: 'spki' });
		return publicKeyFromRaw(new Uint8Array(der.subarray(der.length - 32)));
	}
	const body = s.toLowerCase().startsWith('ed25519:') ? s.slice(8) : s;
	const raw = decodeKeyMaterial(body);
	if (!raw || raw.length !== 32) throw new Error('Invalid Ed25519 public key');
	return publicKeyFromRaw(raw);
}

/**
 * Loads a private signing key: a PKCS#8 PEM, or a 32-byte seed as hex /
 * base64 (optionally prefixed `ed25519-seed:`).
 */
export function loadPrivateKey(spec: string): PrivateKeyInfo {
	const s = spec.trim();
	let key: KeyObject;
	if (s.startsWith('-----BEGIN')) {
		key = createPrivateKey(s);
	} else {
		const body = s.toLowerCase().startsWith('ed25519-seed:') ? s.slice(13) : s;
		const seed = decodeKeyMaterial(body);
		if (!seed || seed.length !== 32) throw new Error('Invalid Ed25519 seed (expected 32 bytes hex/base64)');
		const der = new Uint8Array(PKCS8_PREFIX.length + 32);
		der.set(PKCS8_PREFIX, 0);
		der.set(seed, PKCS8_PREFIX.length);
		key = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
	}
	if (key.asymmetricKeyType !== 'ed25519') throw new Error('Signing key must be Ed25519');
	const pubDer = createPublicKey(key).export({ format: 'der', type: 'spki' });
	return { key, publicKey: publicKeyFromRaw(new Uint8Array(pubDer.subarray(pubDer.length - 32))) };
}

/** A fresh key pair; `seed` is what goes into the signer's secret store. */
export function generateSigningKey(): { seedHex: string; publicKey: PublicKeyInfo } {
	const { privateKey } = generateKeyPairSync('ed25519');
	const der = privateKey.export({ format: 'der', type: 'pkcs8' });
	const seed = new Uint8Array(der.subarray(der.length - 32));
	const info = loadPrivateKey(bytesToHex(seed));
	return { seedHex: bytesToHex(seed), publicKey: info.publicKey };
}

export function messageBytes(domain: string, payload: unknown): Buffer {
	return Buffer.from(`${domain}\n${canonicalJson(payload)}`, 'utf8');
}

export function signPayload(domain: string, payload: unknown, key: PrivateKeyInfo): string {
	return nodeSign(null, messageBytes(domain, payload), key.key).toString('base64');
}

export function verifyPayload(domain: string, payload: unknown, signatureB64: string, key: PublicKeyInfo): boolean {
	try {
		const sig = Buffer.from(signatureB64, 'base64');
		if (sig.length !== 64) return false;
		return nodeVerify(null, messageBytes(domain, payload), key.key, sig);
	} catch {
		return false;
	}
}

export interface SignatureBlock {
	alg: 'ed25519';
	keyId: string;
	sig: string;
}

/** Returns `{...payload, signature}` where the signature covers everything else. */
export function attachSignature<T extends object>(domain: string, payload: T, key: PrivateKeyInfo): T & { signature: SignatureBlock } {
	const signature: SignatureBlock = { alg: 'ed25519', keyId: key.publicKey.keyId, sig: signPayload(domain, payload, key) };
	return { ...payload, signature };
}

/**
 * Verifies an object carrying a `signature` block against a set of trusted
 * keys. Returns the key that verified, or null.
 */
export function verifyAttached(domain: string, signed: unknown, trusted: PublicKeyInfo[]): PublicKeyInfo | null {
	if (!signed || typeof signed !== 'object' || Array.isArray(signed)) return null;
	const { signature, ...payload } = signed as Record<string, unknown> & { signature?: SignatureBlock };
	if (!signature || signature.alg !== 'ed25519' || typeof signature.sig !== 'string') return null;
	const candidates = trusted.filter((k) => k.keyId === signature.keyId);
	for (const k of candidates) if (verifyPayload(domain, payload, signature.sig, k)) return k;
	return null;
}
