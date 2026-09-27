import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';
import { env } from '$env/dynamic/private';
import { betterAuthSecret } from './auth-secret';

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
	secret: betterAuthSecret(),
	baseURL: env.BETTER_AUTH_URL || 'http://localhost:5173',
	trustedOrigins: [
		'https://ozone.redacted.gg',
		'https://ozone.redacted.gg',
		'http://localhost:5173'
	],
	emailAndPassword: {
		enabled: true,
		// Ozone is invite-only (see /api/admin/invite): the app never exposes
		// self-service sign-up, so the endpoint better-auth mounts by default
		// must not accept registrations either.
		disableSignUp: true
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24 // 1 day
	},
	// Ozone stores no IP addresses — not even for admin sessions.
	advanced: {
		ipAddress: { disableIpTracking: true }
	}
});
