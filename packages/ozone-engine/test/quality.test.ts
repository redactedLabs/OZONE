/**
 * End to end on real-data fixtures: parse the lists, trace a real Bybit
 * THORChain swap, build + sign a snapshot, verify it with the client and
 * run the quality gates (known positives must hit, known negatives must
 * not), then screen THORChain users — including the two hub accounts the
 * old screener wrongly flagged.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { decodePayload, generateSigningKey, loadPrivateKey, verifyManifest, type SnapshotIndex } from '../../ozone-client/src/index.js';
import { publishSnapshot } from '../src/jobs.js';
import { parseEthLabels, parseScamSniffer } from '../src/sources/community.js';
import { parseEuFsfXml } from '../src/sources/eu.js';
import { foldEvents, TETHER_SPEC, ORACLE_SPEC } from '../src/sources/events.js';
import { FBI_PUBLICATIONS, parseFbiPublication } from '../src/sources/fbi.js';
import { parseOfacSdnXml } from '../src/sources/ofac.js';
import { parseCurated } from '../src/sources/registry.js';
import { parseUkSanctionsXml } from '../src/sources/uk.js';
import { screenUsers } from '../src/screen/users.js';
import { applySourceResult } from '../src/store/entries.js';
import { runTraceBackfill } from '../src/trace/jobs.js';
import type { MidgardAction } from '../src/trace/midgard.js';
import { emptyResult } from '../src/types.js';
import { FakeMidgard, memoryDb } from './helpers.js';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const known = JSON.parse(fx('known-sets.json')) as {
	positives: Array<{ address: string; chain: string; why: string; source: string; live?: boolean }>;
	negatives: Array<{ address: string; chain: string; why: string }>;
};

describe('quality gates on real-data fixtures', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const key = loadPrivateKey(generateSigningKey().seedHex);
	let index: SnapshotIndex;

	it('ingests every source', async () => {
		const apply = (id: string, kind: string, res: ReturnType<typeof emptyResult>) =>
			applySourceResult(sql, { id, name: id, kind }, res);
		await apply('ofac_sdn', 'sanctions', parseOfacSdnXml(fx('ofac-sdn-excerpt.xml')));
		await apply('uk_fcdo', 'sanctions', parseUkSanctionsXml(fx('uk-excerpt.xml')));
		await apply('eu_fsf', 'sanctions', parseEuFsfXml(fx('eu-excerpt.xml')));
		await apply('fbi', 'law_enforcement', parseFbiPublication(fx('fbi-psa250226.html'), FBI_PUBLICATIONS[0]));
		await apply('ethlabels', 'community', parseEthLabels(JSON.parse(fx('ethlabels-excerpt.json'))));
		await apply('scamsniffer', 'community', parseScamSniffer(JSON.parse(fx('scamsniffer-excerpt.json'))));
		await apply('curated', 'curated', parseCurated());
		// Tether: a real frozen address (the old live DB's flag) + Tornado Cash via the oracle, delisted 2025-03-21
		const tether = emptyResult();
		tether.entries = foldEvents(
			[{ kind: 'add', address: '0x1ea3eb07180e408d2742821aa7d94f6c06064fcd', chain: 'ETH', time: 1_700_000_000, tx: '0xabc', txUrl: 'https://etherscan.io/tx/0xabc', order: 1 }],
			TETHER_SPEC
		);
		await apply('tether', 'stablecoin', tether);
		const oracle = emptyResult();
		oracle.entries = foldEvents(
			[
				{ kind: 'add', address: '0x8589427373d6d84e98730d7795d8f6f8731fda16', chain: 'ETH', time: 1_659_900_000, tx: '0x1', txUrl: 'u', order: 1 },
				{ kind: 'remove', address: '0x8589427373d6d84e98730d7795d8f6f8731fda16', chain: 'ETH', time: 1_742_515_200, tx: '0x2', txUrl: 'u', order: 2 }
			],
			ORACLE_SPEC
		);
		await apply('chainalysis_oracle', 'sanctions', oracle);
		const n = await sql.query<{ n: number }>(`SELECT count(DISTINCT key)::int AS n FROM oz_entries WHERE removed_at IS NULL`);
		expect(n.rows[0].n).toBeGreaterThan(150);
	});

	it('traces the Bybit ETH→BTC swap through THORChain', async () => {
		const actions = Object.values(JSON.parse(fx('midgard-bybit-exploiter-actions.json')) as Record<string, MidgardAction[]>).flat();
		const r = await runTraceBackfill(sql, new FakeMidgard(actions));
		expect(r.errors).toBe(0);
		expect(r.traced).toBeGreaterThanOrEqual(1);
	});

	it('publishes a snapshot that verifies with the client', async () => {
		const s = await publishSnapshot(sql, key);
		const stored = await sql.query<{ manifest: unknown; payload: Uint8Array }>(`SELECT manifest, payload FROM oz_snapshots WHERE version = $1`, [s.version]);
		const manifest = verifyManifest(stored.rows[0].manifest, [key.publicKey]);
		index = decodePayload(manifest, new Uint8Array(stored.rows[0].payload));
		expect(index.version).toBe(s.version);
		expect(s.stats.traced).toBeGreaterThanOrEqual(1);
		expect(s.stats.twins).toBeGreaterThan(0);
	});

	it('every known positive is flagged, with provenance', () => {
		const misses: string[] = [];
		for (const p of known.positives.filter((x) => !x.live)) {
			const v = index.screen(p.address, p.chain);
			if (v.status !== 'flagged') misses.push(`${p.address} (${p.why}): ${v.status}`);
			else {
				const top = v.reasons[0];
				expect(top.text.length).toBeGreaterThan(10);
				expect(top.source).toBeTruthy();
				if (p.source !== 'thorchain_trace') expect(top.ref ?? top.refId).toBeTruthy();
			}
		}
		expect(misses).toEqual([]);
		// also without a chain hint, and in any case form
		expect(index.screen('0x51e9d833ecae4e8d9d8be17300aee6d3398c135d').status).toBe('flagged');
		expect(index.screen('0x1ea3eb07180e408d2742821aa7d94f6c06064fcd').status).toBe('flagged');
	});

	it('every known negative stays clean (history is reported, never flagged)', () => {
		for (const n of known.negatives) {
			const v = index.screen(n.address, n.chain);
			expect(v.valid, n.why).toBe(true);
			expect(v.status, n.why).toBe('clean');
		}
		const tc = index.screen('0x8589427373D6D84E98730D7795D8f6f8731FDA16', 'ETH');
		expect(tc.reasons[0]?.removedAt).toBe('2025-03-21T00:00:00.000Z');
	});

	it('same-key twin: the TRON address of a listed EVM key is flagged one level lower', () => {
		// Lazarus (OFAC) ETH key 0x098b…2f96 → its TRON twin
		const v = index.screen('TAqg8TXo8tmpaz7TwHS669Tgt8MPSWgoxB', 'TRON');
		expect(v.status).toBe('flagged');
		expect(v.reasons[0].code).toBe('SAME_KEY');
		expect(v.risk).toBe('high');
		expect(v.reasons[0].text).toMatch(/same private key as 0x098b716b8aaf21512996dc57eb0615e2383e2f96/);
	});

	it('flags THORChain users directly or through links — never the fee-collector hubs', async () => {
		const collector = 'thor1dl7un46w7l7f3ewrnrm6nq58nerjtp0dradjtd';
		const affiliate = 'thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l';
		const linkedUser = 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';
		const cleanUser = 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55';
		for (const u of [collector, affiliate, linkedUser, cleanUser]) await sql.query(`INSERT INTO rujira_users (thor_address) VALUES ($1)`, [u]);
		// the collector module is linked to a Tether-frozen swapper (exactly the old false positive)
		await sql.query(`INSERT INTO l1_addresses (thor_address, l1_address, chain) VALUES ($1,$2,'ETH')`, [collector, '0x1ea3eb07180e408d2742821aa7d94f6c06064fcd']);
		// the interface affiliate address is linked to 600 swappers, one of them frozen
		for (let i = 0; i < 600; i++) {
			await sql.query(`INSERT INTO l1_addresses (thor_address, l1_address, chain) VALUES ($1,$2,'ETH')`, [affiliate, `0x${(i + 1).toString(16).padStart(40, '0')}`]);
		}
		await sql.query(`INSERT INTO l1_addresses (thor_address, l1_address, chain) VALUES ($1,$2,'ETH')`, [affiliate, '0x1ea3eb07180e408d2742821aa7d94f6c06064fcd']);
		// an ordinary account linked to an OFAC-listed address
		await sql.query(`INSERT INTO l1_addresses (thor_address, l1_address, chain) VALUES ($1,$2,'ETH')`, [linkedUser, '0x098b716b8aaf21512996dc57eb0615e2383e2f96']);

		const r = await screenUsers(sql, index);
		expect(r.flagged).toBe(1);
		expect(r.hubsSkipped).toBe(2);
		const rows = await sql.query<{ thor_address: string; flagged: boolean; risk: string | null }>(
			`SELECT thor_address, flagged, risk FROM rujira_users ORDER BY thor_address`
		);
		const by = new Map(rows.rows.map((x) => [x.thor_address, x]));
		expect(by.get(linkedUser)).toMatchObject({ flagged: true, risk: 'high' });
		expect(by.get(collector)?.flagged).toBe(false);
		expect(by.get(affiliate)?.flagged).toBe(false);
		expect(by.get(cleanUser)?.flagged).toBe(false);
	});
});
