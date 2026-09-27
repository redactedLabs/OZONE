import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpJson } from '../src/util/http.js';

describe('polite HTTP (public gateways and explorers)', () => {
	let server: Server;
	let base = '';
	const hits = new Map<string, number>();
	beforeAll(async () => {
		server = createServer((req, res) => {
			const n = (hits.get(req.url ?? '') ?? 0) + 1;
			hits.set(req.url ?? '', n);
			if (req.url === '/limited' && n === 1) {
				res.writeHead(429, { 'retry-after': '1' }).end('slow down');
				return;
			}
			if (req.url === '/busy' && n <= 2) {
				res.writeHead(503).end('x'.repeat(100_000)); // an error body that is never read
				return;
			}
			if (req.url === '/stall') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.write('{"actions":[');
				return; // never finishes
			}
			res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
		base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	});
	afterAll(() => {
		server.closeAllConnections();
		server.close();
	});

	it('waits as long as a 429 asks (Retry-After), then succeeds', async () => {
		const t0 = Date.now();
		expect(await httpJson(`${base}/limited`, { retries: 2 })).toEqual({ ok: true });
		expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
		expect(Date.now() - t0).toBeLessThan(4000);
	});

	it('releases unread error bodies and retries 5xx', async () => {
		expect(await httpJson(`${base}/busy`, { retries: 3 })).toEqual({ ok: true });
		expect(hits.get('/busy')).toBe(3);
	});

	it('never hangs past its timeout, even when the body stalls', async () => {
		const t0 = Date.now();
		await expect(httpJson(`${base}/stall`, { retries: 0, timeoutMs: 500 })).rejects.toThrow();
		expect(Date.now() - t0).toBeLessThan(3000);
	});
});
