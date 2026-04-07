/**
 * One-off script: Reset password for f@redacted.gg
 * Run with: npx tsx scripts/reset-password.ts
 * Requires DATABASE_URL env var.
 *
 * Uses the same scrypt config as better-auth (N=16384, r=16, p=1, dkLen=64).
 * Format: salt:hash (hex encoded).
 */
import pg from 'pg';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL env var required');
	process.exit(1);
}

// Match better-auth's hashing: salt:key, scrypt N=16384 r=16 p=1 dkLen=64
async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const key = await scryptAsync(password.normalize('NFKC'), salt, 64, {
		N: 16384,
		r: 16,
		p: 1,
		maxmem: 128 * 16384 * 16 * 2
	}) as Buffer;
	return `${salt}:${key.toString('hex')}`;
}

async function main() {
	const pool = new pg.Pool({ connectionString: DATABASE_URL });

	try {
		// Find user
		const userResult = await pool.query(
			`SELECT u.id, u.email FROM "user" u WHERE u.email = $1`,
			['f@redacted.gg']
		);

		if (userResult.rows.length === 0) {
			console.error('User f@redacted.gg not found');
			process.exit(1);
		}

		const userId = userResult.rows[0].id;
		console.log(`Found user: ${userId} (${userResult.rows[0].email})`);

		const newPassword = 'AnOlFiSi69$';
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

		console.log(`Password updated successfully for f@redacted.gg`);
	} finally {
		await pool.end();
	}
}

main().catch(console.error);
