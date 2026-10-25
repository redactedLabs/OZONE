/**
 * Errata E-68 (15) R4-J1: the page's window seed per history file: random once (platform CSPRNG), kept per
 * fingerprint in the page's own storage, the same every later time; never derived from the file.
 */
import { describe, expect, it, vi } from 'vitest';
import { windowSeedFor, type SeedStorage } from './seed';

class MemStorage implements SeedStorage {
	m = new Map<string, string>();
	getItem(k: string) {
		return this.m.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, v);
	}
}

describe('window seed', () => {
	it('is random, made once with getRandomValues, kept under the fingerprint, and given back the same', () => {
		const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
		const s = new MemStorage();
		const a = windowSeedFor('0011223344556677', s);
		expect(a.kept).toBe(true);
		expect(a.seed).toMatch(/^[0-9a-f]{64}$/);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(s.getItem('ozone.view.window-seed.0011223344556677')).toBe(a.seed);
		expect(windowSeedFor('0011223344556677', s)).toEqual(a);
		expect(spy).toHaveBeenCalledTimes(1);
		const b = windowSeedFor('8899aabbccddeeff', s);
		expect(b.seed).not.toBe(a.seed);
		// another browser (another storage) makes its own: nothing ties the seed to the file
		expect(windowSeedFor('0011223344556677', new MemStorage()).seed).not.toBe(a.seed);
		spy.mockRestore();
	});

	it('replaces a kept value that is not a seed', () => {
		const s = new MemStorage();
		s.setItem('ozone.view.window-seed.0011223344556677', 'not a seed');
		const a = windowSeedFor('0011223344556677', s);
		expect(a.seed).toMatch(/^[0-9a-f]{64}$/);
		expect(s.getItem('ozone.view.window-seed.0011223344556677')).toBe(a.seed);
	});

	it('without storage: not kept (the page says so), the same seed for this page load', () => {
		const broken: SeedStorage = {
			getItem() {
				throw new Error('SecurityError');
			},
			setItem() {
				throw new Error('SecurityError');
			}
		};
		const a = windowSeedFor('1111222233334444', broken);
		expect(a.kept).toBe(false);
		expect(windowSeedFor('1111222233334444', broken)).toEqual(a);
		expect(windowSeedFor('1111222233334444', null)).toEqual(a);
		// a storage that silently drops writes is not "kept" either
		const dropping: SeedStorage = { getItem: () => null, setItem: () => {} };
		expect(windowSeedFor('5555666677778888', dropping).kept).toBe(false);
	});

	it('takes only a fingerprint as the key', () => {
		expect(() => windowSeedFor('{"version":"hops/v1/history"}', new MemStorage())).toThrow();
	});
});
