/**
 * The viewer's block-window seed for a history file (errata E-68 (14) R3-J3, (15) R4-J1): one random
 * 32-byte seed per file fingerprint, made with `crypto.getRandomValues` the first time this browser
 * verifies the file, kept in this page's own storage and given back every later time. It is never derived
 * from the file and never sent anywhere: it only chooses which block heights around the cut the page asks
 * the chain sources for, so checking a file again asks the same heights instead of narrowing the cut down.
 *
 * When the browser keeps no storage for the page the seed lives for this page load only, and the page
 * says that repeat checks may reveal the cut to node operators.
 */

const KEY_PREFIX = 'ozone.view.window-seed.';
const HEX64 = /^[0-9a-f]{64}$/;
const FINGERPRINT = /^[0-9a-f]{16}$/;

export interface SeedStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** This page's `localStorage`, or null when the browser refuses it (private mode, blocked site data). */
export function pageStorage(): SeedStorage | null {
	try {
		const s = globalThis.localStorage;
		return s ?? null;
	} catch {
		return null;
	}
}

/** Seeds this page load made where storage failed (so one load still asks one window per file). */
const unkept = new Map<string, string>();

function randomSeed(): string {
	const b = new Uint8Array(32);
	globalThis.crypto.getRandomValues(b);
	let s = '';
	for (const x of b) s += x.toString(16).padStart(2, '0');
	return s;
}

/** The seed for `fingerprint`, and whether this browser keeps it for later checks. */
export function windowSeedFor(fingerprint: string, storage: SeedStorage | null = pageStorage()): { seed: string; kept: boolean } {
	if (!FINGERPRINT.test(fingerprint)) throw new Error('a file fingerprint is 16 hex characters');
	const key = KEY_PREFIX + fingerprint;
	if (storage) {
		try {
			const have = storage.getItem(key);
			if (have && HEX64.test(have)) return { seed: have, kept: true };
			const seed = unkept.get(fingerprint) ?? randomSeed();
			storage.setItem(key, seed);
			if (storage.getItem(key) === seed) {
				unkept.delete(fingerprint);
				return { seed, kept: true };
			}
			unkept.set(fingerprint, seed);
			return { seed, kept: false };
		} catch {
			/* storage refused: below */
		}
	}
	let seed = unkept.get(fingerprint);
	if (!seed) unkept.set(fingerprint, (seed = randomSeed()));
	return { seed, kept: false };
}
