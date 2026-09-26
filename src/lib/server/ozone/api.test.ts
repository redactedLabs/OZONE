/**
 * API contract tests: the SvelteKit route handlers run against an embedded
 * Postgres (PGlite) seeded by the engine. Covers signed answers, the legacy
 * shape the relayer node parses, snapshot download → client verification
 * round trip, health, submissions (no request metadata stored),
 * server-computed certificates and the "no data → 503, never clean" rule.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateSigningKey, loadPrivateKey, OzoneClient, verifyAttached, verifyScreenResponse, DOMAIN_CERTIFICATE } from '$ozone/index.js';
import { applySourceResult, migrate, parseCurated, parseFbiPublication, parseOfacSdnXml, publishSnapshot, FBI_PUBLICATIONS, type Sql } from '$engine/index.js';

const holder: { sql?: Sql } = {};
vi.mock('$lib/server/ozone/sql', () => ({
	get sql() {
		return holder.sql;
	}
}));

const apiKey = loadPrivateKey(generateSigningKey().seedHex);
const snapKey = loadPrivateKey(generateSigningKey().seedHex);
process.env.OZONE_API_SIGNING_KEY = Buffer.from(apiKey.key.export({ format: 'der', type: 'pkcs8' })).subarray(-32).toString('hex');
process.env.OZONE_SNAPSHOT_PUBLIC_KEYS = snapKey.publicKey.spec;

const fx = (name: string) => readFileSync(new URL(`../../../../packages/ozone-engine/test/fixtures/${name}`, import.meta.url), 'utf8');

type Handler = (event: any) => Promise<Response>;
const call = async (h: Handler, init: { url: string; method?: string; body?: unknown; params?: Record<string, string> }) => {
	const url = new URL(init.url, 'https://ozone.test');
	const request = new Request(url, {
		method: init.method ?? 'GET',
		...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {})
	});
	return h({ request, url, params: init.params ?? {}, locals: { user: null } });
};

describe('API routes', () => {
	let db: PGlite;

	beforeAll(async () => {
		db = await PGlite.create();
		holder.sql = db as unknown as Sql;
		await migrate(holder.sql, { baseline: true });
	});
	afterAll(() => db.close());

	it('answers 503 — never "clean" — before any list was ingested', async () => {
		const { POST } = await import('../../../routes/api/v1/screen/+server');
		const res = await call(POST as Handler, { url: '/api/v1/screen', method: 'POST', body: { addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'] } });
		expect(res.status).toBe(503);
	});

	it('serves signed batch verdicts once data and a snapshot exist', async () => {
		const sql = holder.sql!;
		await applySourceResult(sql, { id: 'ofac_sdn', name: 'OFAC', kind: 'sanctions' }, parseOfacSdnXml(fx('ofac-sdn-excerpt.xml')));
		await applySourceResult(sql, { id: 'fbi', name: 'FBI', kind: 'law_enforcement' }, parseFbiPublication(fx('fbi-psa250226.html'), FBI_PUBLICATIONS[0]));
		await applySourceResult(sql, { id: 'curated', name: 'Curated', kind: 'curated' }, parseCurated());
		await publishSnapshot(sql, snapKey);

		const { POST } = await import('../../../routes/api/v1/screen/+server');
		const res = await call(POST as Handler, {
			url: '/api/v1/screen',
			method: 'POST',
			body: { addresses: ['0x098B716B8Aaf21512996dC57EB0615e2383E2f96', { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', chain: 'BTC' }, 'nope'] }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		const verified = verifyScreenResponse(body, [apiKey.publicKey.spec]);
		expect(verified).not.toBeNull();
		expect(body.results.map((r: { status: string }) => r.status)).toEqual(['flagged', 'clean', 'invalid']);
		expect(body.results[0].reasons[0]).toMatchObject({ source: 'ofac_sdn', category: 'sanctions', risk: 'severe' });
		expect(body.snapshot.version).toBeGreaterThan(0);
		// tampering breaks the signature
		body.results[0].status = 'clean';
		expect(verifyScreenResponse(body, [apiKey.publicKey.spec])).toBeNull();

		const bad = await call(POST as Handler, { url: '/api/v1/screen', method: 'POST', body: { addresses: new Array(101).fill('x') } });
		expect(bad.status).toBe(400);
	});

	it('keeps the legacy GET /api/screen shape the relayer node parses', async () => {
		const { GET } = await import('../../../routes/api/screen/+server');
		const res = await call(GET as Handler, { url: '/api/screen?address=0x51E9d833Ecae4E8D9D8Be17300AEE6D3398C135D' });
		const body = await res.json();
		expect(typeof body.flagged).toBe('boolean');
		expect(body.flagged).toBe(true);
		expect(body.matches[0].source).toBe('fbi');
		expect(body.reference).toMatch(/^oz:v\d+:flagged:FBI_DPRK$/);
		expect(verifyScreenResponse(body.attestation, [apiKey.publicKey.spec])).not.toBeNull();
		const clean = await (await call(GET as Handler, { url: '/api/screen?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' })).json();
		expect(clean).toMatchObject({ flagged: false, matches: [] });
		const invalid = await call(GET as Handler, { url: '/api/screen?address=hello' });
		expect(invalid.status).toBe(400);
		// the queried address was not persisted anywhere
		const users = await holder.sql!.query<{ n: number }>(`SELECT count(*)::int AS n FROM rujira_users`);
		expect(users.rows[0].n).toBe(0);
	});

	it('snapshot endpoints round-trip into a verifying node client', async () => {
		const manifestRoute = await import('../../../routes/api/v1/snapshot/+server');
		const payloadRoute = await import('../../../routes/api/v1/snapshot/[version]/+server');
		const fakeFetch = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			if (url.pathname === '/api/v1/snapshot') return call(manifestRoute.GET as Handler, { url: url.toString() });
			const version = url.pathname.split('/').pop()!;
			return call(payloadRoute.GET as Handler, { url: url.toString(), params: { version } });
		}) as typeof fetch;
		const client = new OzoneClient({ trustedKeys: [snapKey.publicKey.spec], manifestUrls: ['https://ozone.test/api/v1/snapshot'], fetch: fakeFetch });
		await client.refresh();
		expect(client.screen('0x098b716b8aaf21512996dc57eb0615e2383e2f96').status).toBe('flagged');
		expect(client.screen('3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG', 'BTC').reasons[0].source).toBe('curated');
		// a node pinned to another key refuses the same snapshot
		const other = new OzoneClient({ trustedKeys: [apiKey.publicKey.spec], manifestUrls: ['https://ozone.test/api/v1/snapshot'], fetch: fakeFetch });
		await expect(other.refresh()).rejects.toThrow();
	});

	it('health reports snapshot age and sources', async () => {
		const { GET } = await import('../../../routes/api/health/+server');
		const res = await call(GET as Handler, { url: '/api/health' });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.snapshot.version).toBeGreaterThan(0);
		expect(body.sources.map((s: { id: string }) => s.id)).toContain('ofac_sdn');
		expect(body.signing.responses).toBe(true);
	});

	it('stores reports without request metadata and exposes their status', async () => {
		const { POST } = await import('../../../routes/api/v1/submissions/+server');
		const res = await call(POST as Handler, {
			url: '/api/v1/submissions',
			method: 'POST',
			body: { kind: 'appeal', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', message: 'This is the genesis address, nobody controls it.' }
		});
		expect(res.status).toBe(201);
		const { publicId } = await res.json();
		const cols = await holder.sql!.query<{ column_name: string }>(
			`SELECT column_name FROM information_schema.columns WHERE table_name = 'oz_submissions'`
		);
		expect(cols.rows.map((c) => c.column_name).some((c) => /ip|agent|header/.test(c))).toBe(false);
		const status = await import('../../../routes/api/v1/submissions/[id]/+server');
		const s = await (await call(status.GET as Handler, { url: `/api/v1/submissions/${publicId}`, params: { id: publicId } })).json();
		expect(s).toMatchObject({ publicId, kind: 'appeal', status: 'open' });
		const honeypot = await call(POST as Handler, { url: '/api/v1/submissions', method: 'POST', body: { kind: 'report', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', message: 'spam spam spam', website: 'x' } });
		expect(honeypot.status).toBe(400);
	});

	it('certificates: the verdict is computed server-side and signed, whatever the client claims', async () => {
		const { POST } = await import('../../../routes/api/certificate/+server');
		const res = await call(POST as Handler, {
			url: '/api/certificate',
			method: 'POST',
			body: { address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96', flagged: false }
		});
		const body = await res.json();
		expect(body.flagged).toBe(true);
		expect(body.certificate.status).toBe('flagged');
		expect(verifyAttached(DOMAIN_CERTIFICATE, body.certificate, [apiKey.publicKey])).not.toBeNull();
	});
});
