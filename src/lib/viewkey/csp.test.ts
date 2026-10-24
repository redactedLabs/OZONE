/**
 * /view's Content-Security-Policy: network only to the two chain sources and Ozone itself, scripts only
 * from Ozone (a nonce for the inline bootstrap), WebAssembly for the client module; other pages unchanged.
 */
import { describe, expect, it } from 'vitest';
import { addNonce, viewCsp } from './csp';

process.env.BETTER_AUTH_SECRET ??= 'test-only-better-auth-secret-not-a-real-secret';
const { handle } = await import('../../hooks.server');

const directives = (csp: string) => Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

describe('/view Content-Security-Policy', () => {
	it('connects only to the chain sources and Ozone; scripts from Ozone with a nonce; wasm allowed', () => {
		const d = directives(viewCsp('abc'));
		expect(d['connect-src']).toEqual(["'self'", 'https://rpc.redacted.money', 'https://gateway.liquify.com']);
		expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'wasm-unsafe-eval'"]);
		expect(d['default-src']).toEqual(["'self'"]);
		expect(d['worker-src']).toEqual(["'self'"]);
		expect(d['object-src']).toEqual(["'none'"]);
		expect(d['frame-ancestors']).toEqual(["'none'"]);
		expect(d['form-action']).toEqual(["'none'"]);
		expect(d['base-uri']).toEqual(["'none'"]);
		const tokens = viewCsp('abc').split(/[\s;]+/);
		expect(tokens).not.toContain("'unsafe-eval'");
		expect(tokens.filter((t) => t.includes('*'))).toEqual([]);
	});

	it('gives every script tag the nonce, once', () => {
		const html = '<script>a()</script><script type="module" src="/x.js"></script><script nonce="n0">b()</script><scripts>';
		expect(addNonce(html, 'N')).toBe('<script nonce="N">a()</script><script nonce="N" type="module" src="/x.js"></script><script nonce="n0">b()</script><scripts>');
	});

	it('is set on /view by the server hook, with nonces in the page, and not on other pages', async () => {
		const call = async (routeId: string) => {
			const url = new URL(`https://ozone.test${routeId}`);
			let html = '';
			const res = await handle({
				event: { request: new Request(url), url, route: { id: routeId }, locals: {} } as never,
				resolve: (async (_e: unknown, opts?: { transformPageChunk?: (x: { html: string; done: boolean }) => string }) => {
					html = opts?.transformPageChunk ? opts.transformPageChunk({ html: '<html><script>boot()</script></html>', done: true }) : '<html><script>boot()</script></html>';
					return new Response(html, { headers: { 'content-type': 'text/html' } });
				}) as never
			});
			return { res, html };
		};
		const v = await call('/view');
		const csp = v.res.headers.get('content-security-policy')!;
		const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
		expect(v.html).toContain(`<script nonce="${nonce}">boot()</script>`);
		expect(directives(csp)['connect-src']).toEqual(["'self'", 'https://rpc.redacted.money', 'https://gateway.liquify.com']);
		expect(v.res.headers.get('referrer-policy')).toBe('no-referrer');
		expect(v.res.headers.get('cache-control')).toBe('no-store');
		const again = await call('/view');
		expect(again.res.headers.get('content-security-policy')).not.toBe(csp);
		const other = await call('/certificate');
		expect(other.res.headers.get('content-security-policy')).toBeNull();
		expect(other.html).toBe('<html><script>boot()</script></html>');
	});
});
