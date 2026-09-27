/**
 * One-off script: reset an account's password.
 * Run with: OZONE_RESET_EMAIL=... OZONE_RESET_PASSWORD=... npx tsx scripts/reset-password.ts
 * Requires DATABASE_URL, OZONE_RESET_EMAIL and OZONE_RESET_PASSWORD env vars
 * — it refuses to run without all three, and never falls back to a
 * hard-coded email or password.
 *
 * Uses the same scrypt config as better-auth (N=16384, r=16, p=1, dkLen=64).
 * Format: salt:hash (hex encoded). Also revokes the account's existing
 * sessions: a password reset (e.g. because the old one leaked) must not
 * leave sessions opened under it still valid.
 */
import pg from 'pg';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const scryptAsync = promisify(scrypt);

// Match better-auth's hashing: salt:key, scrypt N=16384 r=16 p=1 dkLen=64
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const key = (await scryptAsync(password.normalize('NFKC'), salt, 64, {
		N: 16384,
		r: 16,
		p: 1,
		maxmem: 128 * 16384 * 16 * 2
	})) as Buffer;
	return `${salt}:${key.toString('hex')}`;
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;
	const email = process.env.OZONE_RESET_EMAIL;
	const newPassword = process.env.OZONE_RESET_PASSWORD;

	if (!DATABASE_URL) {
		console.error('DATABASE_URL env var required');
		process.exit(1);
	}
	if (!email) {
		console.error('OZONE_RESET_EMAIL env var required (the account to reset)');
		process.exit(1);
	}
	if (!newPassword || newPassword.length < 8) {
		console.error('OZONE_RESET_PASSWORD env var required (at least 8 characters)');
		process.exit(1);
	}

	const pool = new pg.Pool({ connectionString: DATABASE_URL });

	try {
		// Find user
		const userResult = await pool.query(
			`SELECT u.id, u.email FROM "user" u WHERE u.email = $1`,
			[email]
		);

		if (userResult.rows.length === 0) {
			console.error(`User ${email} not found`);
			process.exit(1);
		}

		const userId = userResult.rows[0].id;
		console.log(`Found user: ${userId} (${userResult.rows[0].email})`);

		const hashed = await hashPassword(newPassword);

		// Update password in account table
		const updateResult = await pool.query(
			`UPDATE account SET password = $1, updated_at = NOW() WHERE user_id = $2 AND provider_id = 'credential'`,
			[hashed, userId]
		);

		if (updateResult.rowCount === 0) {
			console.error('No credential account found for this user');
			process.exit(1);
		}

		// Revoke every existing session for this account: an old session
		// opened under the password being replaced must not stay valid.
		const revoked = await pool.query(`DELETE FROM session WHERE user_id = $1`, [userId]);

		console.log(`Password updated successfully for ${email}; revoked ${revoked.rowCount ?? 0} existing session(s)`);
	} finally {
		await pool.end();
	}
}

// Run only when executed directly (`tsx scripts/reset-password.ts`), never
// on import — this lets hashPassword() be unit-tested without also
// requiring DATABASE_URL/OZONE_RESET_EMAIL/OZONE_RESET_PASSWORD to be set,
// or a real connection attempt, just to load the module.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch(console.error);
}
