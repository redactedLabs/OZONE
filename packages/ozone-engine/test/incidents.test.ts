/**
 * The curated incident dataset: every address valid with its own source and
 * confidence, reasons that name their incident, risk by confidence, one
 * entry per address across incidents, and delisting through the normal sync.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { CURATED, parseCurated, sourceById, validateIncidents, incidentStats, type CuratedData } from '../src/index.js';
import { applySourceResult } from '../src/store/entries.js';
import { memoryDb } from './helpers.js';

const known = JSON.parse(readFileSync(new URL('./fixtures/known-sets.json', import.meta.url), 'utf8')) as { negatives: Array<{ address: string }> };

describe('the curated incident dataset', () => {
	const res = parseCurated();

	it('is valid: checksums (EIP-55 for mixed case), https sources, roles, confidence', () => {
		expect(validateIncidents(CURATED)).toEqual([]);
	});

	it('covers at least 30 incidents, most of them 2023-2026, with the THORChain ones sourced', () => {
		const stats = incidentStats();
		expect(stats.incidents).toBeGreaterThanOrEqual(30);
		expect(CURATED.incidents.filter((i) => i.date >= '2023-01-01').length).toBeGreaterThanOrEqual(30);
		expect(stats.thorchain).toBeGreaterThanOrEqual(10);
		for (const inc of CURATED.incidents.filter((i) => i.thorchain.used === 'yes')) expect(inc.thorchain.ref).toMatch(/^https:\/\//);
		expect(stats.searched).toBeGreaterThanOrEqual(10);
		for (const s of CURATED.searched) expect(s.why.length).toBeGreaterThan(10);
	});

	it('publishes high confidence as severe and medium as high; every reason names its incident', () => {
		const byKey = new Map(res.entries.map((e) => [e.key, e]));
		for (const inc of CURATED.incidents) {
			for (const a of inc.addresses) {
				const e = [...byKey.values()].find((x) => x.address.toLowerCase() === a.address.toLowerCase())!;
				expect(e).toBeDefined();
				if (e.meta?.incident !== inc.id) continue; // named by a stronger incident first (tested below)
				expect(e.risk).toBe(a.confidence === 'high' ? 'severe' : 'high');
				expect(e.entity).toBe(inc.name);
				expect(e.text.startsWith(inc.name)).toBe(true);
				expect(e.refUrl).toBe(a.ref);
			}
		}
		// law-enforcement lists name no single theft: no start time; hack incidents count from the theft
		const fbi = res.entries.find((e) => e.key === 'btc:3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG')!;
		expect(fbi).toMatchObject({ category: 'law_enforcement', risk: 'severe', code: 'FBI_DPRK' });
		expect(fbi.meta?.since).toBeUndefined();
		const kelp = res.entries.find((e) => e.key === 'evm:0x8b1b6c9a6db1304000412dd21ae6a70a82d60d3b')!;
		expect(kelp).toMatchObject({ category: 'exploit', risk: 'high', entity: 'KelpDAO rsETH bridge exploit (2026-04-18)' });
		expect(kelp.meta?.since).toBe('2026-04-17T00:00:00.000Z');
	});

	it('keeps returned-funds incidents as history only', () => {
		const euler = res.entries.find((e) => e.key === 'evm:0xb66cd966670d962c227b3eaba30a872dbfb995db')!;
		expect(euler.removedAt).toBe('2023-04-04');
		expect(euler.meta?.removedReason).toMatch(/returned/);
	});

	it('never lists a known clean address, a THORChain module or router', () => {
		const keys = new Set(res.entries.map((e) => e.address.toLowerCase()));
		for (const n of known.negatives) expect(keys.has(n.address.toLowerCase())).toBe(false);
		for (const service of [
			'0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146', // THORChain ETH router
			'0x28c6c06298d514db089934071355e5743bf21d60', // Binance 14
			'0x63dfe4e34a3bfc00eb0220786238a7c6cef8ffc4' // WOO X hot wallet (the victim, named on the same page as its attackers)
		]) {
			expect(keys.has(service)).toBe(false);
		}
	});

	it('the validator refuses bad edits', () => {
		const base = CURATED.incidents[0];
		const bad = (patch: Partial<(typeof base)['addresses'][number]>): CuratedData => ({
			...CURATED,
			incidents: [{ ...base, addresses: [{ ...base.addresses[0], ...patch }] }]
		});
		expect(validateIncidents(bad({ chain: 'BTC', address: '3LU8wRuZnXP4UM8Yo6kkTiGHM9BubgyiG' })).join()).toMatch(/not a valid BTC address/);
		expect(validateIncidents(bad({ chain: 'ETH', address: '0x47666FAB8bd0Ac7003bce3f5C3585383F09486E2' })).join()).toMatch(/EIP-55/);
		expect(validateIncidents(bad({ refType: 'investigator', confidence: 'high' })).join()).toMatch(/medium confidence/);
		expect(validateIncidents(bad({ ref: 'http://example.com' })).join()).toMatch(/https/);
		expect(() => parseCurated(bad({ chain: 'ETH', address: '0x1234' }))).toThrow(/curated incidents/);
	});

	it('an address named by two incidents is one entry that names both, with the stronger confidence', () => {
		const a = CURATED.incidents.find((i) => i.id === 'kelpdao-2026')!;
		const b = CURATED.incidents.find((i) => i.id === 'kucoin-2020')!;
		const shared = a.addresses[0];
		const data: CuratedData = {
			...CURATED,
			incidents: [
				{ ...a, addresses: [shared] },
				{ ...b, addresses: [{ ...shared, refType: 'victim', confidence: 'high', ref: b.ref }] }
			]
		};
		const r = parseCurated(data);
		expect(r.entries).toHaveLength(1);
		expect(r.entries[0]).toMatchObject({ risk: 'severe', entity: b.name });
		expect(r.entries[0].text).toMatch(/Also named in: KelpDAO/);
		expect(r.entries[0].meta?.alsoIncidents).toEqual(['kelpdao-2026']);
	});
});

describe('delisting through the normal sync', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const def = sourceById('curated')!;

	it('an address marked delisted, or an incident removed, is kept as history and stops flagging', async () => {
		await applySourceResult(sql, def, parseCurated());
		const active0 = (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_entries WHERE source = 'curated' AND removed_at IS NULL`)).rows[0].n;
		const kelp = CURATED.incidents.find((i) => i.id === 'kelpdao-2026')!;
		const edited: CuratedData = {
			...CURATED,
			incidents: CURATED.incidents
				.filter((i) => i.id !== 'stake-2023')
				.map((i) => (i.id === kelp.id ? { ...i, addresses: i.addresses.map((a, j) => (j === 0 ? { ...a, delisted: { date: '2026-09-28', reason: 'misattribution (test)' } } : a)) } : i))
		};
		const stats = await applySourceResult(sql, def, parseCurated(edited));
		const stake = CURATED.incidents.find((i) => i.id === 'stake-2023')!;
		expect(stats.active).toBe(active0 - stake.addresses.length - 1);
		const row = (
			await sql.query<{ removed_at: string | null; meta: Record<string, unknown> }>(`SELECT removed_at, meta FROM oz_entries WHERE source = 'curated' AND key = $1`, [
				`evm:${kelp.addresses[0].address.toLowerCase()}`
			])
		).rows[0];
		expect(row.removed_at).not.toBeNull();
		expect(row.meta.removedReason).toBe('misattribution (test)');
		const gone = (
			await sql.query<{ removed_at: string | null }>(`SELECT removed_at FROM oz_entries WHERE source = 'curated' AND key = $1`, [`evm:${stake.addresses[0].address.toLowerCase()}`])
		).rows[0];
		expect(gone.removed_at).not.toBeNull();
		// back in the dataset: reactivated
		const back = await applySourceResult(sql, def, parseCurated());
		expect(back.active).toBe(active0);
	});
});
