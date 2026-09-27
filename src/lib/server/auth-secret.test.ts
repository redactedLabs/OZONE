import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('betterAuthSecret', () => {
	const ORIGINAL = process.env.BETTER_AUTH_SECRET;

	beforeEach(() => {
		vi.resetModules();
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.BETTER_AUTH_SECRET;
		else process.env.BETTER_AUTH_SECRET = ORIGINAL;
		vi.doUnmock('$app/environment');
		vi.resetModules();
	});

	it('uses BETTER_AUTH_SECRET when it is set, dev or not', async () => {
		process.env.BETTER_AUTH_SECRET = 'a-real-configured-secret';
		const { betterAuthSecret } = await import('./auth-secret');
		expect(betterAuthSecret()).toBe('a-real-configured-secret');
	});

	it('falls back to a dev-only value under `vite dev`, never outside it', async () => {
		delete process.env.BETTER_AUTH_SECRET;
		vi.doMock('$app/environment', () => ({ dev: true }));
		const { betterAuthSecret } = await import('./auth-secret');
		expect(betterAuthSecret()).toBeTruthy();
		expect(betterAuthSecret()).not.toBe('dev-secret-change-me'); // the old hard-coded literal must be gone
	});

	it('fails closed outside dev when unset — no hard-coded fallback', async () => {
		delete process.env.BETTER_AUTH_SECRET;
		vi.doMock('$app/environment', () => ({ dev: false }));
		const { betterAuthSecret } = await import('./auth-secret');
		expect(() => betterAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
	});
});
