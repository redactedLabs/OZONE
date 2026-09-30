import { afterAll, describe, expect, it } from 'vitest';
import { generateSigningKey, loadPrivateKey } from '../../ozone-client/src/index.js';
import { applySourceResult, SanityError } from '../src/store/entries.js';
import { publishSnapshot } from '../src/jobs.js';
import { foldEvents, TETHER_SPEC, ORACLE_SPEC } from '../src/sources/events.js';
import { migrate, MIGRATIONS } from '../src/store/db.js';
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

describe('schema migrations', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('re-apply cleanly and keep data (the worker applies them on every start)', async () => {
		expect(MIGRATIONS.at(-1)).toBe('0006_trace_chain.sql');
		await sql.query(
			`INSERT INTO oz_trace_dust_flows (txid, from_key, from_address, from_chain, to_key, to_chain, to_address, action, usd, hop, origin_key, origin_source, origin_risk, origin_category)
			 VALUES ('MIGTX', 'evm:0xa', '0xa', 'ETH', 'btc:b', 'BTC', 'b', 'send', 30, 1, 'evm:0xa', 'ethlabels', 'high', 'hack')`
		);
		await migrate(sql);
		await migrate(sql);
		const rows = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_trace_dust_flows`);
		expect(rows.rows[0].n).toBe(1);
		const idx = await sql.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = 'oz_trace_dust_flows' ORDER BY 1`);
		expect(idx.rows.map((x) => x.indexname)).toEqual(['oz_trace_dust_flows_group_idx', 'oz_trace_dust_flows_pkey', 'oz_trace_dust_flows_to_idx']);
	});
});

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

describe('entry store: the drop-ratio floor anchors to the 7-day peak, not just the previous sync', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const day = 24 * 3600_000;
	const t0 = new Date('2026-01-01T00:00:00Z');
	const seedEntries = (count: number) => {
		const r = emptyResult();
		for (let i = 1; i <= count; i++) r.entries.push(e(addr(i)));
		return r;
	};

	it('cannot be ratcheted down by several individually-small drops', async () => {
		// day 0: a real baseline of 1000 active entries
		await applySourceResult(sql, src, seedEntries(1000), t0);
		// day 1: an 8% drop (within maxDropRatio 0.1) — allowed on its own
		const s1 = await applySourceResult(sql, src, seedEntries(920), new Date(t0.getTime() + day));
		expect(s1.active).toBe(920);

		// day 2: a further drop to 850. Compared only to the previous sync
		// (920), this is a ~7.6% drop — under the old logic it would have
		// passed, silently taking the list to 850/1000 = 15% below its real
		// (7-day) peak. The floor now anchors to that peak, so it is refused.
		await expect(applySourceResult(sql, src, seedEntries(850), new Date(t0.getTime() + 2 * day))).rejects.toThrowError(SanityError);

		// a milder drop (910, still >= 90% of the 1000 peak) is accepted
		const s2 = await applySourceResult(sql, src, seedEntries(910), new Date(t0.getTime() + 2 * day));
		expect(s2.active).toBe(910);
	});

	it('a peak older than 7 days no longer anchors the floor', async () => {
		// day 11: every recorded observation (1000 @ day 0, 920 @ day 1, 910 @
		// day 2) is now more than 7 days old, so the floor falls back to the
		// current active count (910) alone — a drop far below the original
		// 1000 is judged against 910, not held to the stale peak forever.
		const s = await applySourceResult(sql, src, seedEntries(850), new Date(t0.getTime() + 11 * day));
		expect(s.active).toBe(850);
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

describe('snapshot publication', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('does not republish unchanged content (until it is old), publishes changes at once', async () => {
		const key = loadPrivateKey(generateSigningKey().seedHex);
		const seed = emptyResult();
		for (let i = 1; i <= 20; i++) seed.entries.push(e(addr(i)));
		await applySourceResult(sql, src, seed);
		const t0 = new Date('2026-09-27T00:00:00Z');
		const at = (min: number) => new Date(t0.getTime() + min * 60_000);
		// coreSources: [] — this describe block is about the unchanged/republish
		// lifecycle on a single synthetic 'ofac_sdn'-ish source, not about the
		// core-source completeness gate (covered in the worker's own tests).
		const noGate = { coreSources: [] as string[] };
		const first = await publishSnapshot(sql, key, { now: at(0), ...noGate });
		if (!first.published) throw new Error(first.reason);
		expect(first.unchanged).toBeUndefined();
		// same data 10 minutes later: nothing new for nodes to download
		const same = await publishSnapshot(sql, key, { now: at(10), ...noGate });
		expect(same).toMatchObject({ version: first.version, unchanged: true });
		// a different part layout is a different publication
		const parts = await publishSnapshot(sql, key, { now: at(20), partSize: 256, ...noGate });
		if (!parts.published) throw new Error(parts.reason);
		expect(parts.version).toBeGreaterThan(first.version);
		expect(parts.manifest.payload.parts?.length).toBeGreaterThan(1);
		// new data: published immediately
		const r = emptyResult();
		for (let i = 1; i <= 19; i++) r.entries.push(e(addr(i)));
		r.entries.push(e(addr(99)));
		await applySourceResult(sql, src, r);
		const changed = await publishSnapshot(sql, key, { now: at(30), partSize: 256, ...noGate });
		if (!changed.published) throw new Error(changed.reason);
		expect(changed.version).toBeGreaterThan(parts.version);
		expect(changed.unchanged).toBeUndefined();
		// unchanged but older than the republish interval: republished so its age proves liveness
		const stale = await publishSnapshot(sql, key, { now: at(30 + 7 * 60), partSize: 256, ...noGate });
		if (!stale.published) throw new Error(stale.reason);
		expect(stale.version).toBeGreaterThan(changed.version);
		expect(stale.manifest.prev).toEqual({ version: changed.version, sha256: changed.manifest.payload.sha256 });
	});
});
