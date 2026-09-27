/**
 * Regression for ozone-hook-gate-encoded-pathname-bypass: SvelteKit's router
 * decodes percent-encoding before matching and invoking a route, but
 * event.url.pathname keeps the client's original encoding. A gate that
 * string-compares against the raw pathname can wave through
 * /api/%61dmin/transactions ('a' as %61) even though the framework still
 * dispatches it to the real /api/admin/transactions handler. This test calls
 * the real `handle` export (not a reimplementation of its logic) with no
 * session cookie, so auth.api.getSession() returns null before any database
 * read (verified against the installed better-auth source) — nothing here
 * touches a real database.
 */
import { describe, expect, it } from 'vitest';

process.env.BETTER_AUTH_SECRET = 'test-only-better-auth-secret-not-a-real-secret';

const { handle } = await import('./hooks.server');

describe('hooks.server: admin route gate', () => {
	it('refuses /api/%61dmin/transactions with no session, though it resolves to /api/admin/transactions', async () => {
		const url = new URL('https://ozone.test/api/%61dmin/transactions');
		const request = new Request(url); // no cookies, no Authorization header
		let resolved = false;
		const event = {
			request,
			url,
			route: { id: '/api/admin/transactions' }, // what SvelteKit's router actually resolved this to
			locals: {} as App.Locals
		};

		await expect(
			handle({
				event: event as Parameters<typeof handle>[0]['event'],
				resolve: async () => {
					resolved = true;
					return new Response('ok');
				}
			})
		).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(resolved).toBe(false);
	});

	it('still lets the same route through with a valid CRON_SECRET bearer token', async () => {
		const original = process.env.CRON_SECRET;
		process.env.CRON_SECRET = 'test-cron-secret';
		try {
			const url = new URL('https://ozone.test/api/%63ron/l1'); // 'c' as %63
			const request = new Request(url, { headers: { authorization: 'Bearer test-cron-secret' } });
			let resolved = false;
			const event = { request, url, route: { id: '/api/cron/l1' }, locals: {} as App.Locals };
			const res = await handle({
				event: event as Parameters<typeof handle>[0]['event'],
				resolve: async () => {
					resolved = true;
					return new Response('ok');
				}
			});
			expect(resolved).toBe(true);
			expect(await res.text()).toBe('ok');
		} finally {
			if (original === undefined) delete process.env.CRON_SECRET;
			else process.env.CRON_SECRET = original;
		}
	});
});
