import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/build.js';
import { createOzoneSnapshotSource, OzoneClient, OzoneUnavailableError } from '../src/client.js';
import {
	attachSignature,
	DOMAIN_SCREEN_RESPONSE,
	generateSigningKey,
	loadPrivateKey,
	parsePublicKey
} from '../src/crypto.js';
import { verifyScreenResponse } from '../src/response.js';
import { decodePayload, SnapshotError, verifyManifest } from '../src/snapshot.js';
import type { Reason } from '../src/verdict.js';

const key = loadPrivateKey(generateSigningKey().seedHex);
const other = loadPrivateKey(generateSigningKey().seedHex);
const trusted = [key.publicKey.spec];

const SOURCES = [
	{ id: 'ofac_sdn', name: 'OFAC SDN', kind: 'sanctions', entries: 2 },
	{ id: 'tether_usdt', name: 'Tether USDT freezes', kind: 'stablecoin', entries: 1 },
	{ id: 'thorchain_trace', name: 'THORChain flow tracing', kind: 'trace', entries: 1 }
];

const ofac = (entity: string, removedAt?: string): Reason => ({
	code: 'OFAC_SDN',
	source: 'ofac_sdn',
	category: 'sanctions',
	risk: 'severe',
	text: `Listed on the OFAC SDN list (${entity})`,
	entity,
	chain: 'ETH',
	ref: 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=1',
	refId: '1',
	firstSeen: '2026-01-01T00:00:00Z',
	...(removedAt ? { removedAt } : {})
});

function records() {
	return [
		{ key: 'evm:0x098b716b8aaf21512996dc57eb0615e2383e2f96', reasons: [ofac('LAZARUS GROUP')] },
		{ key: 'evm:0x8589427373d6d84e98730d7795d8f6f8731fda16', reasons: [ofac('TORNADO CASH', '2025-03-21T00:00:00Z')] },
		{
			key: 'tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
			reasons: [
				{
					code: 'TETHER_FROZEN',
					source: 'tether_usdt',
					category: 'stablecoin_freeze',
					risk: 'high',
					text: 'USDT frozen by Tether on TRON',
					chain: 'TRON',
					refId: 'abc'
				} satisfies Reason
			]
		},
		{
			key: 'btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE',
			reasons: [
				{
					code: 'TRACE_SWAP',
					source: 'thorchain_trace',
					category: 'traced',
					risk: 'high',
					text: 'Received 1.21 BTC from a Bybit hack address via THORChain swap',
					chain: 'BTC',
					trace: {
						hop: 1,
						action: 'swap',
						txid: '6F708AFC717FCE07',
						height: 20012046,
						date: '2025-02-25T01:08:44Z',
						from: '0xb21e59b3d4e4d6c5247325dc5fbedbc89afc69f4',
						fromChain: 'ETH',
						amount: '1.21327264 BTC.BTC',
						usd: 111000,
						originKey: 'evm:0xb21e59b3d4e4d6c5247325dc5fbedbc89afc69f4',
						originSource: 'ofac_sdn',
						originEntity: 'Bybit Exploiter 65'
					}
				} satisfies Reason
			]
		}
	];
}

function build(version: number, builtAt = new Date(version * 1000).toISOString(), signer = key) {
	return buildSnapshot({ version, builtAt, sources: SOURCES, records: records(), payloadUrl: `./${version}` }, signer);
}

describe('snapshot build / verify / screen', () => {
	const snap = build(1_790_000_000);

	it('verifies and screens', () => {
		const m = verifyManifest(JSON.parse(JSON.stringify(snap.manifest)), [parsePublicKey(trusted[0])]);
		const idx = decodePayload(m, snap.payload);
		expect(idx.size).toBe(4);
		expect(m.counts).toEqual({ keys: 4, listed: 3, traced: 1, reasons: 4 });

		const now = Date.parse(snap.manifest.builtAt) + 3600_000;
		const hit = idx.screen('0x098B716B8Aaf21512996dC57EB0615e2383E2f96', undefined, { now });
		expect(hit.status).toBe('flagged');
		expect(hit.risk).toBe('severe');
		expect(hit.reasons[0].entity).toBe('LAZARUS GROUP');
		expect(hit.reference).toBe('oz:v1790000000:flagged:OFAC_SDN');
		expect(hit.snapshot?.ageSeconds).toBe(3600);
		expect(hit.snapshot?.stale).toBe(false);

		// same address with an EVM chain hint (BSC) still matches
		expect(idx.screen('0x098b716b8aaf21512996dc57eb0615e2383e2f96', 'BSC', { now }).status).toBe('flagged');

		// delisted: reason kept as history, never flags
		const tc = idx.screen('0x8589427373D6D84E98730D7795D8f6f8731FDA16', 'ETH', { now });
		expect(tc.status).toBe('clean');
		expect(tc.reasons[0].removedAt).toBe('2025-03-21T00:00:00.000Z');

		const traced = idx.screen('19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE', 'BTC', { now });
		expect(traced.status).toBe('flagged');
		expect(traced.reasons[0].trace?.txid).toBe('6F708AFC717FCE07');
		expect(traced.reasons[0].trace?.originEntity).toBe('Bybit Exploiter 65');

		// policy: a node that only blocks severe risk
		expect(idx.screen('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TRON', { now, flagAt: 'severe' }).status).toBe('clean');
		expect(idx.screen('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TRON', { now }).status).toBe('flagged');

		const clean = idx.screen('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', undefined, { now });
		expect(clean.status).toBe('clean');
		expect(clean.valid).toBe(true);
		expect(clean.risk).toBe('none');

		const invalid = idx.screen('0x1234', undefined, { now });
		expect(invalid.status).toBe('invalid');
		expect(idx.screen('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'ADA', { now }).status).toBe('invalid');

		const stale = idx.screen('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', undefined, { now: now + 48 * 3600_000 });
		expect(stale.snapshot?.stale).toBe(true);
	});

	it('rejects tampering, foreign keys and unsigned manifests', () => {
		const keys = [parsePublicKey(trusted[0])];
		const tampered = { ...snap.manifest, counts: { ...snap.manifest.counts, keys: 5 } };
		expect(() => verifyManifest(tampered, keys)).toThrowError(/signature/);
		const foreign = build(1_790_000_000, undefined, other);
		expect(() => verifyManifest(foreign.manifest, keys)).toThrowError(/untrusted/);
		const { signature: _s, ...unsigned } = snap.manifest;
		expect(() => verifyManifest(unsigned, keys)).toThrowError(/not signed/);
		const m = verifyManifest(snap.manifest, keys);
		const bad = new Uint8Array(snap.payload);
		bad[bad.length - 5] ^= 0xff;
		expect(() => decodePayload(m, bad)).toThrowError(SnapshotError);
		expect(() => decodePayload(m, snap.payload.subarray(1))).toThrowError(/size/);
	});
});

describe('OzoneClient', () => {
	const dirs: string[] = [];
	afterAll(async () => {
		for (const d of dirs) await rm(d, { recursive: true, force: true });
	});

	function server(snaps: Map<string, { manifest: object; payload: Uint8Array }>, state: { down: boolean; latest: string }) {
		const calls: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (state.down) throw new TypeError('fetch failed');
			const u = new URL(url);
			if (u.pathname.endsWith('/snapshot')) {
				const s = snaps.get(state.latest)!;
				return new Response(JSON.stringify(s.manifest), { status: 200 });
			}
			const version = u.pathname.split('/').pop()!;
			const s = snaps.get(version);
			if (!s) return new Response('not found', { status: 404 });
			return new Response(new Uint8Array(s.payload).buffer as ArrayBuffer, { status: 200 });
		}) as typeof fetch;
		return { fetchImpl, calls };
	}

	it('loads, refreshes, survives an outage from its cache, refuses rollbacks', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ozone-client-'));
		dirs.push(dir);
		const v1 = build(1_790_000_000);
		const v2 = build(1_790_000_600);
		const snaps = new Map([
			['1790000000', v1],
			['1790000600', v2]
		]);
		const state = { down: false, latest: '1790000000' };
		const { fetchImpl } = server(snaps, state);
		const events: string[] = [];
		const opts = {
			trustedKeys: trusted,
			manifestUrls: ['https://ozone.example/api/v1/snapshot'],
			cacheDir: dir,
			fetch: fetchImpl,
			clock: () => 1_790_000_900_000,
			onEvent: (e: { type: string }) => events.push(e.type)
		};
		const client = new OzoneClient(opts);
		expect(() => client.screen('0x098b716b8aaf21512996dc57eb0615e2383e2f96')).toThrowError(OzoneUnavailableError);
		await client.init();
		expect(client.info()?.version).toBe('1790000000');
		expect(client.screen('0x098b716b8aaf21512996dc57eb0615e2383e2f96').status).toBe('flagged');

		// unchanged manifest → no download
		expect(await client.refresh()).toBe(false);

		state.latest = '1790000600';
		expect(await client.refresh()).toBe(true);
		expect(client.info()?.version).toBe('1790000600');
		expect((await readdir(dir)).sort()).toContain('payload-1790000600.json.gz');

		// server serves an older snapshot again: rollback refused, current kept
		state.latest = '1790000000';
		await expect(client.refresh()).rejects.toThrowError(/refresh failed/);
		expect(client.info()?.version).toBe('1790000600');
		expect(events).toContain('rejected');

		// a new process while Ozone is down: screens from the verified cache
		state.down = true;
		const offline = new OzoneClient(opts);
		await offline.init();
		expect(offline.info()?.version).toBe('1790000600');
		const v = offline.screen('19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE', 'BTC');
		expect(v.status).toBe('flagged');
		expect(v.snapshot?.ageSeconds).toBe(300);
	});

	it('fails over to a mirror and exposes the relayer snapshot-source interface', async () => {
		const v1 = build(1_790_000_000);
		const snaps = new Map([['1790000000', v1]]);
		const state = { down: false, latest: '1790000000' };
		const { fetchImpl, calls } = server(snaps, state);
		const failing = (async (input: string | URL | Request) => {
			if (String(input).includes('primary')) throw new TypeError('fetch failed');
			return fetchImpl(input);
		}) as typeof fetch;
		const source = createOzoneSnapshotSource({
			trustedKeys: trusted,
			manifestUrls: ['https://primary.example/api/v1/snapshot', 'https://mirror.example/api/v1/snapshot'],
			fetch: failing
		});
		expect(source.info()).toBeUndefined();
		await source.refresh();
		expect(calls.some((c) => c.startsWith('https://mirror.example/api/v1/1790000000'))).toBe(true);
		expect(source.info()).toMatchObject({ version: '1790000000', createdAt: 1_790_000_000_000 });
		expect(source.lookup({ address: '0x098b716b8aaf21512996dc57eb0615e2383e2f96', chain: 'ETH' })).toEqual({
			status: 'flagged',
			reference: 'oz:v1790000000:flagged:OFAC_SDN'
		});
		expect(source.lookup({ address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', chain: 'BTC' }).status).toBe('clean');
		expect(source.lookup({ address: 'addr1qxy', chain: 'ADA' })).toEqual({ status: 'unsupported_chain' });
		expect(source.lookup({ address: 'not-an-address', chain: 'BTC' })).toEqual({ status: 'unsupported_chain' });
	});

	it('refuses plain-http remote mirrors and empty key sets', () => {
		expect(() => new OzoneClient({ trustedKeys: trusted, manifestUrls: ['http://evil.example/snap'] })).toThrowError(/https/);
		expect(() => new OzoneClient({ trustedKeys: [] })).toThrowError(/trusted key/);
	});
});

describe('signed screen responses', () => {
	it('verifies what the API signs and rejects edits', () => {
		const body = attachSignature(
			DOMAIN_SCREEN_RESPONSE,
			{
				type: 'ozone.screen.v1' as const,
				id: 'r1',
				issuedAt: '2026-09-27T00:00:00Z',
				policy: { flagAt: 'high' },
				snapshot: null,
				results: []
			},
			key
		);
		expect(verifyScreenResponse(JSON.parse(JSON.stringify(body)), trusted)).not.toBeNull();
		expect(verifyScreenResponse({ ...body, issuedAt: '2026-09-28T00:00:00Z' }, trusted)).toBeNull();
		expect(verifyScreenResponse(body, [other.publicKey.spec])).toBeNull();
	});
});
