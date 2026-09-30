/**
 * Backfill and real-time follower against a Midgard that pages the way the
 * real one does (test/helpers.ts midgardFetch): forward reads from a height,
 * page budgets that resume instead of skipping history, a follower that
 * catches up in chain order, and the backfill order.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { applySourceResult } from '../src/store/entries.js';
import { getState, loadTraceIndex, pendingChecks, seedClass, setState } from '../src/store/trace.js';
import { runRealtimeTick, runTraceBackfill, type PendingAction } from '../src/trace/jobs.js';
import { Midgard, type ForwardRead, type MidgardAction } from '../src/trace/midgard.js';
import { StaticPrices } from '../src/trace/prices.js';
import { DEFAULT_TRACE_CONFIG, type IndexEntry } from '../src/trace/tracer.js';
import { emptyResult, type ListEntry } from '../src/types.js';
import { action, FakeMidgard, memoryDb, midgardFetch } from './helpers.js';

const prices = new StaticPrices(
	new Map([
		['THOR.RUNE', 1.5],
		['BTC.BTC', 90_000],
		['ETH.ETH', 3_000]
	])
);

const midgardOver = (all: MidgardAction[], log: string[] = []) =>
	new Midgard({ baseUrl: 'https://midgard.test', minIntervalMs: 0, concurrency: 4, http: { fetch: midgardFetch(all, log), retries: 0 } });

const evm = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const BTC_A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BTC_B = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

/** Unrelated activity of `address` (value flowing *to* it from third parties). */
function noise(address: string, fromHeight: number, n: number, perHeight = 1): MidgardAction[] {
	const out: MidgardAction[] = [];
	for (let i = 0; i < n; i++) {
		out.push(
			action({
				height: fromHeight + Math.floor(i / perHeight),
				in: [{ address: evm(0xe000 + i), asset: 'ETH.ETH', amount: 0.01 }],
				out: [{ address, asset: 'BTC.BTC', amount: 0.0001 }]
			})
		);
	}
	return out;
}

const entry = (source: string, key: string, address: string, extra: Partial<ListEntry> = {}): ListEntry => ({
	source,
	key,
	chain: 'ETH',
	address,
	category: 'hack',
	risk: 'high',
	code: 'TEST',
	text: 'test listing',
	...extra
});

async function list(sql: Parameters<typeof applySourceResult>[0], source: string, entries: ListEntry[]) {
	const r = emptyResult();
	r.entries.push(...entries);
	await applySourceResult(sql, { id: source, name: source, kind: 'test', maxDropRatio: 1 }, r);
}

describe('Midgard forward reads (fromHeight is inclusive and returns the OLDEST page)', () => {
	const addr = evm(0xa1);
	const all = [...noise(addr, 1, 60), ...noise(addr, 61, 12, 3), ...noise(addr, 65, 60)];

	it('reads every action at or after a height, oldest first (the old nextPageToken walk stopped after one page)', async () => {
		const m = midgardOver(all);
		const got: number[] = [];
		for await (const a of m.actionsForAddress(addr, { fromHeight: 10 })) got.push(Number(a.height));
		const expected = all.map((a) => Number(a.height)).filter((h) => h >= 10);
		expect(got).toHaveLength(expected.length);
		expect(got).toEqual([...got].sort((a, b) => a - b));
		// The way the pre-fix client paged: fromHeight + nextPageToken. The
		// first page is the 50 OLDEST at or after fromHeight, and "next" only
		// ever goes to older actions: everything newer than that first page
		// was never read.
		const first = await m.actions({ address: addr, limit: 50, fromHeight: 10 });
		const firstTop = Math.max(...first.actions.map((a) => Number(a.height)));
		expect(firstTop).toBeLessThan(Math.max(...expected));
		const older = await m.actions({ address: addr, limit: 50, fromHeight: 10, nextPageToken: first.nextPageToken });
		expect(older.actions.every((a) => Number(a.height) <= firstTop)).toBe(true);
		expect(first.actions.length + older.actions.length).toBeLessThan(expected.length);
	});

	it('a read cut short by its page budget says where to resume, and resuming there misses nothing', async () => {
		const m = midgardOver(all);
		const seen = new Set<string>();
		let from = 1;
		let reads = 0;
		for (;;) {
			const progress: ForwardRead = { complete: false };
			for await (const a of m.actionsForAddress(addr, { fromHeight: from, maxPages: 1, progress })) seen.add(a.in[0].txID);
			reads++;
			if (progress.complete) break;
			// resume inclusive at the newest height read (it may continue on the next page)
			expect(progress.resumeHeight).toBeGreaterThan(from - 1);
			from = progress.resumeHeight!;
		}
		expect(seen.size).toBe(all.length);
		expect(reads).toBeGreaterThan(2);
	});
});

describe('backfill: nothing after the first page is skipped any more', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const origin = evm(0xbad1);

	it('a traced key whose onward flow comes more than 50 actions after its taint is still followed', async () => {
		await list(sql, 'ethlabels', [entry('ethlabels', `evm:${origin}`, origin, { entity: 'Test Exploiter 1' })]);
		const taint = action({
			height: 1000,
			in: [{ address: origin, asset: 'ETH.ETH', amount: 100 }],
			out: [{ address: BTC_A, asset: 'BTC.BTC', amount: 3 }],
			metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } }
		});
		// 70 unrelated actions of BTC_A after its taint, then it sends onward
		const onward = action({
			height: 1200,
			in: [{ address: BTC_A, asset: 'BTC.BTC', amount: 2 }],
			out: [{ address: evm(0xc0ffee), asset: 'ETH.ETH', amount: 60 }],
			metadata: { swap: { inPriceUSD: '90000', outPriceUSD: '3000' } }
		});
		const m = midgardOver([taint, ...noise(BTC_A, 1001, 70), onward]);
		const r = await runTraceBackfill(sql, m, { prices });
		expect(r.errors).toBe(0);
		const hop2 = await sql.query<{ key: string; hop: number; risk: string }>(`SELECT key, hop, risk FROM oz_traced WHERE hop = 2`);
		expect(hop2.rows).toEqual([{ key: `evm:${evm(0xc0ffee)}`, hop: 2, risk: 'medium' }]);
	});
});

describe('backfill: a listed key with a long history is read to the end across slices', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const origin = evm(0xbad2);

	it('keeps the key pending until its history is complete, then marks it done', async () => {
		await list(sql, 'ofac_sdn', [entry('ofac_sdn', `evm:${origin}`, origin, { category: 'sanctions', risk: 'severe' })]);
		// the one flow out of the listed key is its OLDEST action; 120 newer ones follow
		const oldest = action({
			height: 50,
			in: [{ address: origin, asset: 'ETH.ETH', amount: 10 }],
			out: [{ address: BTC_B, asset: 'BTC.BTC', amount: 0.5 }],
			metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } }
		});
		const m = midgardOver([oldest, ...noise(origin, 60, 120)]);
		const pages = { neverService: 1 };
		const statusOf = async () =>
			(await sql.query<{ status: string; checked_height: string }>(`SELECT status, checked_height FROM oz_trace_checked WHERE key = $1`, [`evm:${origin}`])).rows[0];

		const r1 = await runTraceBackfill(sql, m, { prices, pages });
		expect(r1.errors).toBe(0);
		// oldest first: the flow is found on the first page already
		expect((await sql.query(`SELECT key FROM oz_traced`)).rows).toEqual([{ key: `btc:${BTC_B}` }]);
		expect((await statusOf()).status).toBe('pending');
		let slices = 1;
		while ((await statusOf()).status === 'pending' && slices < 10) {
			await runTraceBackfill(sql, m, { prices, pages });
			slices++;
		}
		const s = await statusOf();
		expect(s.status).toBe('done');
		expect(Number(s.checked_height)).toBe(60 + 119);
		expect(slices).toBeGreaterThanOrEqual(3);
	});
});

describe('real-time follower: catches up in chain order, never resets the backfill', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const origin = evm(0xbad3);

	it('processes a backlog over several ticks, finds the flagged flow in it, leaves checked keys alone', async () => {
		await list(sql, 'ethlabels', [entry('ethlabels', `evm:${origin}`, origin)]);
		await sql.query(`INSERT INTO oz_trace_checked (key, checked_height, status) VALUES ($1, 90, 'done')`, [`evm:${origin}`]);
		await setState(sql, 'trace:realtime', { height: 100 });
		const backlog: MidgardAction[] = [...noise(BTC_A, 101, 150, 2)];
		const flagged = action({
			height: 140,
			in: [{ address: origin, asset: 'ETH.ETH', amount: 20 }],
			out: [{ address: BTC_B, asset: 'BTC.BTC', amount: 0.6 }],
			metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } }
		});
		const m = midgardOver([...backlog, flagged]);
		const ticks = [];
		for (let i = 0; i < 10; i++) {
			const t = await runRealtimeTick(sql, m, { prices, maxPages: 1 });
			ticks.push(t);
			if (t.complete) break;
		}
		expect(ticks[0].complete).toBe(false);
		expect(ticks.at(-1)!.complete).toBe(true);
		// every tick starts where the previous one stopped (no range skipped)
		for (let i = 1; i < ticks.length; i++) expect(ticks[i].from).toBe(ticks[i - 1].to);
		expect(ticks.at(-1)!.to).toBe(101 + 74); // head
		expect(ticks.reduce((n, t) => n + t.hits, 0)).toBe(1);
		const traced = await sql.query(`SELECT key, hop FROM oz_traced`);
		expect(traced.rows).toEqual([{ key: `btc:${BTC_B}`, hop: 1 }]);
		const checked = await sql.query<{ status: string }>(`SELECT status FROM oz_trace_checked WHERE key = $1`, [`evm:${origin}`]);
		expect(checked.rows[0].status).toBe('done'); // the old follower set every 'done' key back to 'pending' here
		expect(await getState(sql, 'trace:realtime')).toEqual({ height: 175 });
	});
});

describe('backfill order', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('incident keys first; then risk; within a risk: traced, attributions, bulk lists, twins', async () => {
		const base = (key: string, e: Partial<IndexEntry>): IndexEntry => ({
			key,
			hop: 0,
			originRisk: 'high',
			originKey: key,
			originSource: 'x',
			originCategory: 'hack',
			...e
		});
		const index = new Map<string, IndexEntry>(
			[
				base('evm:0x01', { originSource: 'tether', originCategory: 'stablecoin_freeze' }),
				base('evm:0x02', { originSource: 'cluster', originCategory: 'hack' }),
				base('evm:0x03', { originKey: 'tron:TX', originSource: 'tether', originCategory: 'stablecoin_freeze', originRisk: 'medium' }),
				base('evm:0x04', { originKey: 'tron:TY', originSource: 'ofac_sdn', originCategory: 'sanctions' }), // twin of a severe listing, one level lower
				base('btc:b1', { hop: 1, originKey: 'evm:0x09', originSource: 'ethlabels', originCategory: 'hack' }),
				base('btc:b2', { hop: 1, originKey: 'evm:0x08', originSource: 'ofac_sdn', originCategory: 'sanctions', originRisk: 'severe' }),
				base('evm:0x05', { originSource: 'manual', originCategory: 'manual', urgent: true }),
				base('evm:0x06', { originSource: 'scamsniffer', originCategory: 'phishing', originRisk: 'medium' })
			].map((e) => [e.key, e])
		);
		const tasks = await pendingChecks(sql, index, DEFAULT_TRACE_CONFIG.maxHops);
		expect(tasks.map((t) => t.key)).toEqual([
			'evm:0x05', // incident path
			'btc:b2', // traced from a severe origin (priority 49)
			'evm:0x02', // high: attribution
			'evm:0x01', // high: bulk list
			'evm:0x04', // high: twin
			'btc:b1', // hop 1 from a high origin (39)
			'evm:0x06', // medium: bulk list
			'evm:0x03' // medium: twin
		]);
		expect(seedClass(index.get('evm:0x04')!)).toBe(3);
	});

	it('a key whose check failed is retried after a cool-down, not at the top of every slice', async () => {
		const k = (i: number) => `evm:0x${i.toString(16).padStart(40, '0')}`;
		const index = new Map<string, IndexEntry>(
			[1, 2].map((i) => [k(i), { key: k(i), hop: 0, originRisk: 'severe', originKey: k(i), originSource: 'ofac_sdn', originCategory: 'sanctions' } as IndexEntry])
		);
		await sql.query(`INSERT INTO oz_trace_checked (key, status, checked_at, error) VALUES ($1, 'error', now(), 'HTTP 429')`, [k(1)]);
		const now = Date.now();
		expect((await pendingChecks(sql, index, 3, 100, undefined, now)).map((t) => t.key)).toEqual([k(2)]);
		expect((await pendingChecks(sql, index, 3, 100, undefined, now + 31 * 60_000)).map((t) => t.key)).toEqual([k(1), k(2)]);
	});

	it('an urgent maintainer flag, and whatever is traced from it, is on the incident path', async () => {
		await sql.query(`INSERT INTO manual_flags (id, address, chain, reason, active) VALUES (7, '0x00000000000000000000000000000000000000aa', 'ETH', 'test incident', true)`);
		await sql.query(`INSERT INTO oz_manual_meta (flag_id, incident, urgent_until) VALUES (7, 'Test hack', now() + interval '1 hour')`);
		const { manualEntries } = await import('../src/store/entries.js');
		await list(sql, 'manual', await manualEntries(sql));
		await sql.query(
			`INSERT INTO oz_traced (key, chain, address, hop, risk, origin_key, origin_source, origin_risk, origin_category, first_txid, first_height)
			 VALUES ('btc:${BTC_A}', 'BTC', '${BTC_A}', 1, 'high', 'evm:0x00000000000000000000000000000000000000aa', 'manual', 'high', 'manual', 'T1', 5)`
		);
		const index = await loadTraceIndex(sql);
		expect(index.get('evm:0x00000000000000000000000000000000000000aa')?.urgent).toBe(true);
		expect(index.get(`btc:${BTC_A}`)?.urgent).toBe(true);
		const tasks = await pendingChecks(sql, index, DEFAULT_TRACE_CONFIG.maxHops);
		expect(tasks.slice(0, 2).map((t) => t.urgent)).toEqual([true, true]);
	});
});

describe('the follower saves its cursor before it re-reads pending actions', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('a Midgard lookup that never answers cannot keep the cursor where it was (/api/health showed it frozen for 16 h on 2026-09-30)', async () => {
		const origin = `evm:${evm(0xf00d)}`;
		const index = new Map<string, IndexEntry>([
			[origin, { key: origin, hop: 0, originRisk: 'high', originKey: origin, originSource: 'ethlabels', originCategory: 'hack' }]
		]);
		await setState(sql, 'trace:realtime', { height: 99 });
		const pendingSwap = action({ height: 100, status: 'pending', in: [{ address: evm(0xf00d), asset: 'ETH.ETH', amount: 5, txID: 'ABCDHANG' }], out: [] });
		const m = new FakeMidgard([pendingSwap]);
		(m as unknown as { actions: (p: Record<string, unknown>) => Promise<{ actions: MidgardAction[] }> }).actions = (p) =>
			p.txid ? new Promise(() => undefined) : Promise.resolve({ actions: [] });
		const t0 = Date.now();
		const tick = await runRealtimeTick(sql, m, { prices, index, pendingBudgetMs: 50 });
		expect(Date.now() - t0).toBeLessThan(2_000);
		expect(tick).toMatchObject({ processed: 1, from: 99, to: 100, complete: true });
		expect(await getState(sql, 'trace:realtime')).toEqual({ height: 100 });
		// the action stays remembered for the next tick
		expect((await getState<PendingAction[]>(sql, 'trace:pending'))?.map((p) => p.txid)).toEqual(['ABCDHANG']);
	});
});
