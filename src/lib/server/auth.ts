import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';
import { env } from '$env/dynamic/private';

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification
		}
	}),
	secret: env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
	baseURL: env.BETTER_AUTH_URL || 'http://localhost:5173',
	trustedOrigins: [
		'https://ozone.redacted.gg',
		'https://ozone.redacted.gg',
		'http://localhost:5173'
	],
	emailAndPassword: {
		enabled: true
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24 // 1 day
	}
});
