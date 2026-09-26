import { afterAll, describe, expect, it } from 'vitest';
import { applySourceResult, SanityError } from '../src/store/entries.js';
import { foldEvents, TETHER_SPEC, ORACLE_SPEC } from '../src/sources/events.js';
import { decodeAddressArray, toChecksumAddress } from '../src/util/evm.js';
import { emptyResult, type ListEntry } from '../src/types.js';
import { memoryDb } from './helpers.js';

const e = (key: string, extra: Partial<ListEntry> = {}): ListEntry => ({
	source: 'ofac_sdn',
	key,
	chain: 'ETH',
	address: key.slice(4),
	category: 'sanctions',
	risk: 'severe',
	code: 'OFAC_SDN',
	text: 'Listed on the OFAC SDN list',
	...extra
});
const addr = (i: number) => `evm:0x${i.toString(16).padStart(40, '0')}`;
const src = { id: 'ofac_sdn', name: 'OFAC SDN list', kind: 'sanctions', minEntries: 5, maxDropRatio: 0.1 };

describe('entry store: delistings and sanity checks', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('imports, delists what disappears, reactivates what returns', async () => {
		const r1 = emptyResult();
		for (let i = 1; i <= 20; i++) r1.entries.push(e(addr(i)));
		expect((await applySourceResult(sql, src, r1)).active).toBe(20);

		const r2 = emptyResult();
		for (let i = 1; i <= 19; i++) r2.entries.push(e(addr(i)));
		const s2 = await applySourceResult(sql, src, r2);
		expect(s2).toMatchObject({ active: 19, removed: 1 });
		const gone = await sql.query<{ removed_at: string | null; meta: { removedReason?: string } }>(
			`SELECT removed_at, meta FROM oz_entries WHERE key = $1`,
			[addr(20)]
		);
		expect(gone.rows[0].removed_at).not.toBeNull();
		expect(gone.rows[0].meta.removedReason).toBe('no longer published by the source');

		r2.entries.push(e(addr(20)));
		const s3 = await applySourceResult(sql, src, r2);
		expect(s3).toMatchObject({ active: 20, reactivated: 1 });
	});

	it('refuses a truncated download instead of mass-delisting', async () => {
		const small = emptyResult();
		for (let i = 1; i <= 15; i++) small.entries.push(e(addr(i)));
		await expect(applySourceResult(sql, src, small)).rejects.toThrowError(SanityError);
		const tiny = emptyResult();
		tiny.entries.push(e(addr(1)));
		await expect(applySourceResult(sql, { ...src, maxDropRatio: 1 }, tiny)).rejects.toThrowError(/minimum/);
		const active = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_entries WHERE removed_at IS NULL`);
		expect(active.rows[0].n).toBe(20);
	});
});

describe('event-sourced lists', () => {
	const ev = (kind: 'add' | 'remove', address: string, chain: string, time: number) => ({
		kind,
		address,
		chain,
		time,
		tx: `0x${time.toString(16)}`,
		txUrl: `https://explorer/tx/${time}`,
		order: time
	});

	it('Tether: freeze → unfreeze → refreeze, per chain, TRON hex converted to T-addresses', () => {
		const out = foldEvents(
			[
				ev('add', '0x1111111111111111111111111111111111111111', 'ETH', 100),
				ev('remove', '0x1111111111111111111111111111111111111111', 'ETH', 200),
				ev('add', '0x2222222222222222222222222222222222222222', 'ETH', 100),
				ev('add', '0x2222222222222222222222222222222222222222', 'AVAX', 150),
				ev('remove', '0x2222222222222222222222222222222222222222', 'AVAX', 300),
				ev('add', '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c', 'TRON', 400),
				ev('add', '0x3333333333333333333333333333333333333333', 'ETH', 100),
				ev('remove', '0x3333333333333333333333333333333333333333', 'ETH', 200),
				ev('add', '0x3333333333333333333333333333333333333333', 'ETH', 500)
			],
			TETHER_SPEC
		);
		const by = new Map(out.map((x) => [x.key, x]));
		const one = by.get('evm:0x1111111111111111111111111111111111111111')!;
		expect(one.removedAt).toBe(new Date(200_000).toISOString());
		expect(one.text).toMatch(/unfrozen/);
		// frozen on ETH, released on AVAX: still active
		const two = by.get('evm:0x2222222222222222222222222222222222222222')!;
		expect(two.removedAt).toBeUndefined();
		expect(two.listedAt).toBe(new Date(100_000).toISOString());
		// TronGrid hex → base58 T-address (never stored as 0x hex like the old worker did)
		expect(by.get('tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')?.chain).toBe('TRON');
		expect(by.has('evm:0xa614f803b6fd780986a42c78ec9c7f77e6ded13c')).toBe(false);
		// refrozen after an unfreeze: active again, listed at the new freeze
		const three = by.get('evm:0x3333333333333333333333333333333333333333')!;
		expect(three.removedAt).toBeUndefined();
		expect(three.listedAt).toBe(new Date(500_000).toISOString());
	});

	it('Chainalysis oracle: decodes address[] event data; Tornado-style delisting keeps history', () => {
		const data =
			'0x' +
			'0000000000000000000000000000000000000000000000000000000000000020' +
			'0000000000000000000000000000000000000000000000000000000000000002' +
			'0000000000000000000000008589427373d6d84e98730d7795d8f6f8731fda16' +
			'000000000000000000000000722122df12d4e14e13ac3b6895a86e84145b6967';
		const addrs = decodeAddressArray(data);
		expect(addrs).toEqual(['0x8589427373d6d84e98730d7795d8f6f8731fda16', '0x722122df12d4e14e13ac3b6895a86e84145b6967']);
		const out = foldEvents(
			[
				...addrs.map((a, i) => ev('add', a, 'ETH', 1_659_900_000 + i)),
				ev('remove', addrs[0], 'ETH', 1_742_515_200)
			],
			ORACLE_SPEC
		);
		const tc = out.find((x) => x.address === addrs[0])!;
		expect(tc.removedAt).toBe('2025-03-21T00:00:00.000Z');
		expect(tc.text).toMatch(/Formerly sanctioned/);
		expect(out.find((x) => x.address === addrs[1])!.removedAt).toBeUndefined();
	});

	it('EIP-55 checksum (for case-sensitive Midgard queries)', () => {
		expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
		expect(toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
	});
});
