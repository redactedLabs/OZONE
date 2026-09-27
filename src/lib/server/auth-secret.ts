/**
 * BETTER_AUTH_SECRET resolution, split out from auth.ts so it can be
 * unit-tested without pulling in betterAuth/drizzle/the database.
 *
 * There is no hard-coded fallback: a fixed secret that ships in source would
 * let anyone who has read this repository sign session tokens for a real
 * deployment. Outside dev, a missing secret must fail closed (throw), not
 * silently run with a known value.
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

export function betterAuthSecret(): string {
	if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
	if (dev) return 'dev-only-secret-do-not-use-outside-vite-dev';
	throw new Error('BETTER_AUTH_SECRET must be set outside development — refusing to start with no secret configured');
}
