import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from 'better-auth/crypto';
import { hashPassword } from './reset-password';

describe('reset-password: hashPassword', () => {
	it('produces a salt:hash pair that verifies with better-auth\'s own scrypt check', async () => {
		// A synthetic, throwaway test value — never a real credential.
		const testPassword = `test-${randomBytes(12).toString('hex')}`;
		const hashed = await hashPassword(testPassword);

		expect(hashed).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/); // 16-byte salt, 64-byte key, hex

		const valid = await verifyPassword({ hash: hashed, password: testPassword });
		expect(valid).toBe(true);

		const wrong = await verifyPassword({ hash: hashed, password: `${testPassword}-wrong` });
		expect(wrong).toBe(false);
	});

	it('produces a different salt (and hash) on every call, even for the same password', async () => {
		const testPassword = `test-${randomBytes(12).toString('hex')}`;
		const a = await hashPassword(testPassword);
		const b = await hashPassword(testPassword);
		expect(a).not.toBe(b);
	});
});
