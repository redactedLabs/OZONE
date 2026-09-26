/**
 * Signing keys (never logged, never sent to the client):
 *
 * - OZONE_API_SIGNING_KEY — Ed25519 seed (hex/base64) or PKCS#8 PEM; signs
 *   API screen responses and certificates.
 * - OZONE_SNAPSHOT_SIGNING_KEY — only when the app itself publishes
 *   snapshots (normally the worker holds it).
 * - OZONE_SNAPSHOT_PUBLIC_KEYS / OZONE_API_PUBLIC_KEYS — comma-separated
 *   `ed25519:<base64>` keys to publish at /api/v1/keys (e.g. the worker's
 *   snapshot key, or a key being rotated in).
 */
import { env } from '$env/dynamic/private';
import { loadPrivateKey, parsePublicKey, type PrivateKeyInfo, type PublicKeyInfo } from '$ozone/index.js';

const cache = new Map<string, PrivateKeyInfo | null>();

function privateKey(name: 'OZONE_API_SIGNING_KEY' | 'OZONE_SNAPSHOT_SIGNING_KEY'): PrivateKeyInfo | null {
	if (cache.has(name)) return cache.get(name)!;
	const raw = env[name];
	let key: PrivateKeyInfo | null = null;
	if (raw) {
		try {
			key = loadPrivateKey(raw);
		} catch {
			console.error(`[ozone] ${name} is set but is not a valid Ed25519 key`);
		}
	}
	cache.set(name, key);
	return key;
}

export const responseKey = () => privateKey('OZONE_API_SIGNING_KEY');
export const snapshotSigningKey = () => privateKey('OZONE_SNAPSHOT_SIGNING_KEY');

function publicList(name: 'OZONE_SNAPSHOT_PUBLIC_KEYS' | 'OZONE_API_PUBLIC_KEYS'): PublicKeyInfo[] {
	const out: PublicKeyInfo[] = [];
	for (const part of (env[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
		try {
			out.push(parsePublicKey(part));
		} catch {
			console.error(`[ozone] ignoring an invalid key in ${name}`);
		}
	}
	return out;
}

export function publishedKeys(): { snapshot: PublicKeyInfo[]; response: PublicKeyInfo[] } {
	const snapshot = publicList('OZONE_SNAPSHOT_PUBLIC_KEYS');
	const sk = snapshotSigningKey();
	if (sk && !snapshot.some((k) => k.keyId === sk.publicKey.keyId)) snapshot.push(sk.publicKey);
	const response = publicList('OZONE_API_PUBLIC_KEYS');
	const rk = responseKey();
	if (rk && !response.some((k) => k.keyId === rk.publicKey.keyId)) response.push(rk.publicKey);
	return { snapshot, response };
}
