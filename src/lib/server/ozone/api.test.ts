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
import { applySourceResult, emptyResult, migrate, parseCurated, parseFbiPublication, parseOfacSdnXml, publishSnapshot, recordDustFlows, FBI_PUBLICATIONS, type Sql } from '$engine/index.js';

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
// Only $lib/server/auth's own module load needs this (invite/+server.ts
// imports it); nothing in this file exercises betterAuth's DB-backed flows.
process.env.BETTER_AUTH_SECRET = 'test-only-better-auth-secret-not-a-real-secret';

const fx = (name: string) => readFileSync(new URL(`../../../../packages/ozone-engine/test/fixtures/${name}`, import.meta.url), 'utf8');

type Locals = { user: { id: string; email: string; name: string; role: string } | null };
type Handler = (event: any) => Promise<Response>;
const call = async (h: Handler, init: { url: string; method?: string; body?: unknown; params?: Record<string, string>; locals?: Locals }) => {
	const url = new URL(init.url, 'https://ozone.test');
	const request = new Request(url, {
		method: init.method ?? 'GET',
		...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {})
	});
	return h({ request, url, params: init.params ?? {}, locals: init.locals ?? { user: null } });
};
/** A session with no admin/owner role — either hooks.server.ts's fail-closed
 *  default, or (deliberately, for this test) any other non-privileged value. */
const nonAdmin: Locals = { user: { id: 'u1', email: 'nobody@test', name: 'Nobody', role: '' } };

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
		// The remaining core sources aren't under test here (real minEntries
		// like OFAC's 500 or Tether's 1000 would need unrealistic fixture
		// sizes) — record a trivial success so /api/health's "every core
		// source has synced" check is honestly satisfied, and skip the
		// stronger per-count completeness gate below via coreSources: [].
		for (const id of ['uk_fcdo', 'eu_fsf', 'chainalysis_oracle', 'tether', 'circle']) {
			await applySourceResult(sql, { id, name: id, kind: 'sanctions' }, emptyResult());
		}
		await publishSnapshot(sql, snapKey, { coreSources: [] });

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

	it('refuses to publish while a core source has too few active entries, though it synced', async () => {
		const sql = holder.sql!;
		// uk_fcdo/eu_fsf/chainalysis_oracle/tether/circle each recorded a
		// success above, but with 0 active entries — real minEntries (20/5/50/
		// 1000/100) are never met, so the default completeness gate must
		// refuse even though every core source has *attempted* a sync (which
		// is all /api/health itself checks, so that endpoint stays healthy).
		const before = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_snapshots`);
		const result = await publishSnapshot(sql, snapKey);
		expect(result.published).toBe(false);
		if (result.published) throw new Error('expected a refusal');
		expect(result.reason).toMatch(/^not published: core source\(s\) not ready:/);
		const after = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_snapshots`);
		expect(after.rows[0].n).toBe(before.rows[0].n); // nothing new was signed or stored
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

	it('address explanation lists every listing with provenance', async () => {
		const { GET } = await import('../../../routes/api/v1/address/[address]/+server');
		const res = await call(GET as Handler, {
			url: '/api/v1/address/0x098B716B8Aaf21512996dC57EB0615e2383E2f96',
			params: { address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96' }
		});
		const body = await res.json();
		expect(body.verdict.status).toBe('flagged');
		expect(body.listings[0]).toMatchObject({ source: 'ofac_sdn', entity: 'LAZARUS GROUP', ref_url: 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=27307' });
		const bad = await call(GET as Handler, { url: '/api/v1/address/nope', params: { address: 'nope' } });
		expect(bad.status).toBe(400);
	});

	it('address explanation lists the small transfers counted toward a total, each once', async () => {
		const to = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
		const flow = {
			txid: 'SMALLTX1',
			height: 900,
			date: '2025-06-01T00:00:00.000Z',
			action: 'send',
			relation: 'value' as const,
			fromKey: 'evm:0x098b716b8aaf21512996dc57eb0615e2383e2f96',
			fromAddress: '0x098b716b8aaf21512996dc57eb0615e2383e2f96',
			fromChain: 'ETH',
			toKey: `btc:${to}`,
			toAddress: to,
			toChain: 'BTC',
			usd: 30,
			hop: 1,
			originKey: 'evm:0x098b716b8aaf21512996dc57eb0615e2383e2f96',
			originSource: 'ofac_sdn',
			originRisk: 'severe' as const,
			originCategory: 'sanctions' as const
		};
		await recordDustFlows(holder.sql!, [flow, flow]);
		const { GET } = await import('../../../routes/api/v1/address/[address]/+server');
		const body = await (await call(GET as Handler, { url: `/api/v1/address/${to}`, params: { address: to } })).json();
		expect(body.smallTransfersReceived).toHaveLength(1);
		expect(body.smallTransfersReceived[0]).toMatchObject({ txid: 'SMALLTX1', from_address: flow.fromAddress, hop: 1, origin_source: 'ofac_sdn' });
		expect(Number(body.smallTransfersReceived[0].usd)).toBe(30);
	});

	it('serves large payloads in parts (host response limits) that the client reassembles', async () => {
		await publishSnapshot(holder.sql!, snapKey, { partSize: 1024, coreSources: [] });
		const manifestRoute = await import('../../../routes/api/v1/snapshot/+server');
		const payloadRoute = await import('../../../routes/api/v1/snapshot/[version]/+server');
		const manifest = await (await call(manifestRoute.GET as Handler, { url: '/api/v1/snapshot' })).json();
		expect(manifest.payload.parts.length).toBeGreaterThan(1);
		const fakeFetch = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			if (url.pathname === '/api/v1/snapshot') return call(manifestRoute.GET as Handler, { url: url.toString() });
			return call(payloadRoute.GET as Handler, { url: url.toString(), params: { version: url.pathname.split('/').pop()! } });
		}) as typeof fetch;
		const client = new OzoneClient({ trustedKeys: [snapKey.publicKey.spec], manifestUrls: ['https://ozone.test/api/v1/snapshot'], fetch: fakeFetch });
		await client.refresh();
		expect(client.info()?.version).toBe(String(manifest.version));
		expect(client.screen('0x098b716b8aaf21512996dc57eb0615e2383e2f96').status).toBe('flagged');
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

	it('certificates: a chain hint cannot narrow away a listing under the address\'s other valid reading', async () => {
		const { POST } = await import('../../../routes/api/certificate/+server');
		// 3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG is the curated FBI DPRK BTC P2SH
		// address (seeded via parseCurated() earlier in this file, law_enforcement/
		// severe). Read as LTC (P2SH version 0x05 is valid on both chains, and
		// canonicalises to the current 0x32 "M..." form) it has no listing of
		// its own — screening only that hinted reading used to come back
		// clean. The unhinted reading still auto-detects it as BTC and finds
		// the real listing, so the certificate must be flagged either way.
		const hinted = await call(POST as Handler, { url: '/api/certificate', method: 'POST', body: { address: '3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG', chain: 'LTC' } });
		const hintedBody = await hinted.json();
		expect(hintedBody.flagged).toBe(true);
		expect(hintedBody.certificate.status).toBe('flagged');
		// chain and every screened key (both readings) are in the signed document
		expect(hintedBody.certificate.chain).toBe('LTC');
		expect(hintedBody.certificate.keys).toEqual(expect.arrayContaining(['ltc:MSgHFKK2WuNoryd2eg66a6xfc3jduKgTVT', 'btc:3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG']));
		expect(verifyAttached(DOMAIN_CERTIFICATE, hintedBody.certificate, [apiKey.publicKey])).not.toBeNull();

		// unhinted: same address, same result, no chain recorded
		const unhinted = await call(POST as Handler, { url: '/api/certificate', method: 'POST', body: { address: '3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG' } });
		const unhintedBody = await unhinted.json();
		expect(unhintedBody.flagged).toBe(true);
		expect(unhintedBody.certificate.chain).toBeUndefined();
	});

	it('certificates: the permanent page discloses active sub-threshold reasons instead of an unqualified "no matches"', async () => {
		const sql = holder.sql!;
		// A ScamSniffer-style listing (phishing, medium risk — below the
		// default flagAt:'high') for an address nothing else has ever listed.
		const drainer = `0x${(0xabc).toString(16).padStart(40, '0')}`;
		await applySourceResult(
			sql,
			{ id: 'scamsniffer', name: 'ScamSniffer', kind: 'community' },
			{
				entries: [
					{
						source: 'scamsniffer',
						key: `evm:${drainer}`,
						chain: 'ETH',
						address: drainer,
						category: 'phishing',
						risk: 'medium',
						code: 'SCAMSNIFFER',
						entity: 'Phishing / wallet drainer',
						text: 'Listed by ScamSniffer as a phishing/drainer address'
					}
				],
				rejected: [],
				notes: []
			}
		);
		const published = await publishSnapshot(sql, snapKey, { coreSources: [] });
		if (!published.published) throw new Error(published.reason);

		// currentSnapshot() (src/lib/server/ozone/snapshot.ts) caches the
		// in-memory index for up to 60s, keyed off Date.now() — the earlier
		// tests in this file already populated it, so the certificate route
		// would otherwise screen against a snapshot from before this entry
		// existed. Faking only Date (not timers) advances that check without
		// touching PGlite's or the rate limiter's own scheduling.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 61_000);
		let body: { flagged: boolean; certId: string; certificate: { risk: string; reasons: unknown[] } };
		try {
			const { POST } = await import('../../../routes/api/certificate/+server');
			const res = await call(POST as Handler, { url: '/api/certificate', method: 'POST', body: { address: drainer } });
			body = await res.json();
		} finally {
			vi.useRealTimers();
		}
		expect(body.flagged).toBe(false); // medium is below the default flag threshold
		expect(body.certificate.risk).toBe('medium');
		expect(body.certificate.reasons.length).toBeGreaterThan(0);

		const { load } = await import('../../../routes/certificate/[id]/+page.server');
		const loaded: any = await load({ params: { id: body.certId } } as any);
		expect(loaded.legacy).toBe(false);
		expect(loaded.flagged).toBe(false);
		expect(loaded.risk).toBe('medium');
		expect(loaded.reasons.length).toBeGreaterThan(0);
		expect(loaded.reasons[0]).toMatchObject({ source: 'scamsniffer', risk: 'medium' });
		expect(loaded.sourcesChecked).toEqual(expect.arrayContaining(['scamsniffer']));
	});

	it('certificates: a legacy row (document IS NULL) loads as unverifiable, never as clean', async () => {
		const sql = holder.sql!;
		const legacyId = 'OZ-LEGACYTEST1';
		await sql.query(
			`INSERT INTO certificates (cert_id, address, flagged, sources_checked) VALUES ($1,$2,$3,$4)`,
			[legacyId, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', false, 8]
		);
		const { load } = await import('../../../routes/certificate/[id]/+page.server');
		const loaded: any = await load({ params: { id: legacyId } } as any);
		expect(loaded.legacy).toBe(true);
	});

	it('signs maxTraceHop into the policy whenever the caller sets it, omits it otherwise', async () => {
		const { POST } = await import('../../../routes/api/v1/screen/+server');
		const withHop = await call(POST as Handler, {
			url: '/api/v1/screen',
			method: 'POST',
			body: { addresses: ['0x098B716B8Aaf21512996dC57EB0615e2383E2f96'], policy: { maxTraceHop: 0 } }
		});
		const withHopBody = await withHop.json();
		expect(withHopBody.policy).toMatchObject({ flagAt: 'high', maxTraceHop: 0 });
		expect(verifyScreenResponse(withHopBody, [apiKey.publicKey.spec])).not.toBeNull();

		const withoutHop = await call(POST as Handler, {
			url: '/api/v1/screen',
			method: 'POST',
			body: { addresses: ['0x098B716B8Aaf21512996dC57EB0615e2383E2f96'] }
		});
		const withoutHopBody = await withoutHop.json();
		expect(withoutHopBody.policy).toEqual({ flagAt: 'high' });
		expect('maxTraceHop' in withoutHopBody.policy).toBe(false);
	});

	it('report ids are drawn from crypto.randomBytes, not Math.random', async () => {
		const { generateReportId } = await import('../reportId');
		const ids = new Set(Array.from({ length: 200 }, () => generateReportId()));
		expect(ids.size).toBe(200); // no collisions in a small CSPRNG sample
		for (const id of ids) {
			expect(id).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
		}
	});

	it('POST /api/history refuses a non-bech32 address before any DB write or Midgard fetch', async () => {
		const { POST } = await import('../../../routes/api/history/+server');
		const res = await call(POST as Handler, {
			url: '/api/history',
			method: 'POST',
			body: { address: 'thor1not-a-real-bech32-address' }
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/valid thor address/i);
	});

	// A session existing is not enough: hooks.server.ts's role lookup fails
	// closed (role ''), so these verdict-changing endpoints must refuse it
	// exactly like an unauthenticated caller once past the 401 check — the
	// same gap this candidate reports for flags/submissions extends, per the
	// brief, to every /api/admin/* write.
	it('admin writes require role admin/owner, not just a session', async () => {
		const flags = await import('../../../routes/api/admin/flags/+server');
		expect((await call(flags.POST as Handler, { url: '/api/admin/flags', method: 'POST', locals: nonAdmin, body: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', reason: 'x' } })).status).toBe(403);
		expect((await call(flags.DELETE as Handler, { url: '/api/admin/flags', method: 'DELETE', locals: nonAdmin, body: { id: 1 } })).status).toBe(403);

		const submissions = await import('../../../routes/api/admin/submissions/+server');
		expect((await call(submissions.POST as Handler, { url: '/api/admin/submissions', method: 'POST', locals: nonAdmin, body: { publicId: 'x', action: 'accept' } })).status).toBe(403);

		const changePassword = await import('../../../routes/api/admin/change-password/+server');
		expect((await call(changePassword.POST as Handler, { url: '/api/admin/change-password', method: 'POST', locals: nonAdmin, body: { currentPassword: 'a', newPassword: 'bbbbbbbb' } })).status).toBe(403);

		// invite creates/deletes accounts — reached via auth.$context/db only
		// once past this same check, so a 403 here is what proves the gate
		// runs first (this test never lets a passing role reach that code).
		const invite = await import('../../../routes/api/admin/invite/+server');
		expect((await call(invite.POST as Handler, { url: '/api/admin/invite', method: 'POST', locals: nonAdmin, body: { email: 'new@test' } })).status).toBe(403);
		expect((await call(invite.DELETE as Handler, { url: '/api/admin/invite', method: 'DELETE', locals: nonAdmin, body: { userId: 'x' } })).status).toBe(403);

		// sync-trigger's existing owner-only check must still be in force,
		// not loosened to "any admin" by this change.
		const syncTrigger = await import('../../../routes/api/admin/sync-trigger/+server');
		const admin: Locals = { user: { id: 'u2', email: 'admin@test', name: 'Admin', role: 'admin' } };
		expect((await call(syncTrigger.POST as Handler, { url: '/api/admin/sync-trigger', method: 'POST', locals: admin, body: { type: 'snapshot' } })).status).toBe(403);
	});
});
