/**
 * The watcher for new hack money arriving at THORChain: large inbounds from
 * unflagged L1 addresses are queued by the real-time follower and looked
 * back on (1–2 hops of funders) by a separate job; a listed or traced
 * funder gives the depositor a traced reason, and its THORChain outputs are
 * then traced as usual. Every network call is served by the fakes.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
	configureHost,
	enqueueWatch,
	Esplora,
	loadLatestIndex,
	loadTraceIndex,
	publishSnapshot,
	processWatchQueue,
	runRealtimeTick,
	runTraceBackfill,
	setState,
	watchCandidates,
	watchMetrics,
	DEFAULT_WATCH_CONFIG,
	StaticPrices,
	type IndexEntry,
	type MidgardAction,
	type Sql
} from '../src/index.js';
import { generateSigningKey, loadPrivateKey } from '../../ozone-client/src/index.js';
import { applySourceResult } from '../src/store/entries.js';
import { emptyResult, type ListEntry } from '../src/types.js';
import { fakeExplorers, FakeEsplora, fastHosts, utxoTx } from './explorer-fakes.js';
import { action, FakeMidgard, memoryDb } from './helpers.js';

const evm = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const prices = new StaticPrices(
	new Map([
		['ETH.ETH', 3_000],
		['BTC.BTC', 90_000],
		['THOR.RUNE', 1.5],
		['ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', 1]
	])
);
const DEPOSIT_TIME = '2026-09-28T10:00:00Z';
const T = Date.parse(DEPOSIT_TIME) / 1000;
const LISTED = evm(0x1a); // an incident's attacker address
const DEPOSITOR = evm(0xd0);
const MIDDLE = evm(0x3d);
const BTC_OUT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const listed = (key: string, address: string, extra: Partial<ListEntry> = {}): ListEntry => ({
	source: 'curated',
	key,
	chain: 'ETH',
	address,
	category: 'hack',
	risk: 'severe',
	code: 'INCIDENT_EXPLOITER',
	entity: 'Test exploit (2026-09-01)',
	text: 'Test exploit (2026-09-01): attacker address',
	...extra
});

async function list(sql: Sql, entries: ListEntry[]) {
	const r = emptyResult();
	r.entries.push(...entries);
	await applySourceResult(sql, { id: 'curated', name: 'curated', kind: 'curated', maxDropRatio: 1 }, r);
}

const swapIn = (from: string, eth: number, height: number, extra: Partial<Parameters<typeof action>[0]> = {}) =>
	action({
		height,
		date: DEPOSIT_TIME,
		in: [{ address: from, asset: 'ETH.ETH', amount: eth, txID: `IN${height}` }],
		out: [{ address: BTC_OUT, asset: 'BTC.BTC', amount: (eth * 3_000) / 90_000 }],
		metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } },
		...extra
	});

describe('which inbounds are watched', () => {
	const lookup = (k: string): IndexEntry | undefined =>
		k === `evm:${LISTED}` ? { key: k, hop: 0, originRisk: 'severe', originKey: k, originSource: 'curated', originCategory: 'hack' } : undefined;
	it('large inbounds from unflagged L1 addresses only', () => {
		const actions: MidgardAction[] = [
			swapIn(DEPOSITOR, 20, 100), // $60k: watched
			swapIn(evm(0xd1), 5, 101), // $15k: under the threshold
			swapIn(LISTED, 50, 102), // listed: the normal tracing covers it
			action({ height: 103, in: [{ address: 'thor1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg386we8s', asset: 'THOR.RUNE', amount: 100_000 }], out: [] }), // RUNE: not an L1 inbound
			action({ height: 104, in: [{ address: evm(0xd2), asset: 'ETH~ETH', amount: 30 }], out: [] }), // a trade asset
			action({ height: 105, type: 'addLiquidity', in: [{ address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', asset: 'BTC.BTC', amount: 1 }], out: [] }) // $90k BTC add
		];
		const c = watchCandidates(actions, lookup, prices);
		expect(c.map((x) => [x.key, Math.round(x.usd), x.action])).toEqual([
			['btc:1BoatSLRHtKNngkdXEeobR76b53LETtpyT', 90_000, 'addLiquidity'],
			[`evm:${DEPOSITOR}`, 60_000, 'swap']
		]);
		expect(watchCandidates(actions, lookup, prices, { ...DEFAULT_WATCH_CONFIG, minUsd: 100_000 })).toEqual([]);
	});
});

describe('look-backs', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	beforeEach(async () => {
		fastHosts();
		await sql.query(`DELETE FROM oz_watch_queue`);
		await sql.query(`DELETE FROM oz_l1_funders`);
		await sql.query(`DELETE FROM oz_traced`);
		await sql.query(`DELETE FROM oz_trace_edges`);
	});
	await list(sql, [listed(`evm:${LISTED}`, LISTED)]);
	const enqueue = async (address: string, eth: number, chain = 'ETH', asset = 'ETH.ETH', txid = 'INTX') => {
		const key = chain === 'BTC' ? `btc:${address}` : `evm:${address}`;
		await enqueueWatch(sql, [{ key, chain, address, txid, height: 28_000_000, date: DEPOSIT_TIME, usd: eth * 3_000, asset, action: 'swap' }]);
		return key;
	};
	const queue = async (key: string) =>
		(await sql.query<{ status: string; reason: string | null; result: Record<string, unknown> | null }>(`SELECT status, reason, result FROM oz_watch_queue WHERE key = $1`, [key])).rows[0];

	it('a direct funder on a list: the depositor is traced one hop from it', async () => {
		const fetch = fakeExplorers({
			txs: [
				{ from: LISTED, to: DEPOSITOR, eth: 30, time: T - 3600 },
				{ from: evm(0xcafe), to: DEPOSITOR, eth: 0.1, time: T - 7200 }
			]
		});
		const key = await enqueue(DEPOSITOR, 25);
		const m = await processWatchQueue(sql, { http: { fetch, retries: 0 } });
		expect(m).toMatchObject({ lookbacks: 1, hits: 1, errors: 0 });
		expect((await queue(key)).status).toBe('hit');
		const t = (await sql.query<{ hop: number; risk: string; origin_key: string; origin_entity: string; first_height: string }>(`SELECT hop, risk, origin_key, origin_entity, first_height FROM oz_traced WHERE key = $1`, [key])).rows[0];
		expect(t).toMatchObject({ hop: 1, risk: 'high', origin_key: `evm:${LISTED}`, origin_entity: 'Test exploit (2026-09-01)' });
		expect(Number(t.first_height)).toBe(28_000_000 - 1);
		const edge = (await sql.query<{ action: string; reason: string }>(`SELECT action, reason FROM oz_trace_edges WHERE to_key = $1`, [key])).rows[0];
		expect(edge.action).toBe('l1_funding');
		expect(edge.reason).toMatch(/^Funded by 0x0+1a \(listed by Test exploit \(2026-09-01\) \(curated\)\) one hop before THORChain: received 30 ETH/);
		const metrics = await watchMetrics(sql);
		expect(metrics?.totals).toMatchObject({ enqueued: 1, lookbacks: 1, hits: 1 });
	});

	it('a funder two hops back: traced at hop 2 through the intermediate address', async () => {
		const fetch = fakeExplorers({
			txs: [
				{ from: MIDDLE, to: DEPOSITOR, eth: 30, time: T - 3600 },
				{ from: LISTED, to: MIDDLE, eth: 31, time: T - 7200 }
			]
		});
		const key = await enqueue(DEPOSITOR, 25);
		const m = await processWatchQueue(sql, { http: { fetch, retries: 0 } });
		expect(m.hits).toBe(1);
		const row = await queue(key);
		expect(row.result).toMatchObject({ via: MIDDLE, origin: LISTED, originKey: `evm:${LISTED}`, hop: 2, risk: 'medium' });
		const edge = (await sql.query<{ action: string; from_address: string; reason: string }>(`SELECT action, from_address, reason FROM oz_trace_edges WHERE to_key = $1`, [key])).rows[0];
		expect(edge).toMatchObject({ action: 'l1_funding2', from_address: MIDDLE });
		expect(edge.reason).toMatch(/^Funded two hops before THORChain from Test exploit/);
	});

	it('the deposited token counts too (USDT funded by a listed address)', async () => {
		const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
		const fetch = fakeExplorers({ txs: [], tokenTxs: [{ token: usdt, from: LISTED, to: DEPOSITOR, amount: 80_000, time: T - 600 }] });
		const key = `evm:${DEPOSITOR}`;
		await enqueueWatch(sql, [{ key, chain: 'ETH', address: DEPOSITOR, txid: 'X', height: 28_000_000, date: DEPOSIT_TIME, usd: 80_000, asset: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', action: 'swap' }]);
		const m = await processWatchQueue(sql, { http: { fetch, retries: 0 } });
		expect(m.hits).toBe(1);
		expect((await sql.query<{ amount: string }>(`SELECT amount FROM oz_trace_edges WHERE to_key = $1`, [key])).rows[0].amount).toBe('80000 USDT');
	});

	it('skips services, contracts and chains without an explorer; a spent quota leaves rows pending', async () => {
		const busy = evm(0xb0);
		const txs = Array.from({ length: 200 }, (_, i) => ({ from: evm(0x9000 + i), to: busy, eth: 1, time: T - 60 * (i + 1) }));
		const aggregator = evm(0xa99);
		const fetch = fakeExplorers({ txs: [...txs, { from: LISTED, to: aggregator, eth: 30, time: T - 100 }], contracts: [aggregator] });
		const kBusy = await enqueue(busy, 25);
		const kAgg = await enqueue(aggregator, 25);
		const kBsc = `evm:${evm(0xb5c)}`;
		await enqueueWatch(sql, [{ key: kBsc, chain: 'BSC', address: evm(0xb5c), txid: 'X', height: 1, date: DEPOSIT_TIME, usd: 50_000, asset: 'BSC.BNB', action: 'swap' }]);
		const m = await processWatchQueue(sql, { http: { fetch, retries: 0 }, env: {} });
		expect(m.hits).toBe(0);
		expect(m.skipped).toMatchObject({ service: 1, contract: 1, noExplorer: 1 });
		expect((await queue(kBusy)).reason).toMatch(/service/);
		expect((await queue(kAgg)).reason).toMatch(/contract/);
		expect((await queue(kBsc)).reason).toMatch(/no explorer API for BSC/);
		// a spent quota: nothing is lost, the row waits for the next run
		configureHost('api.routescan.io', { minIntervalMs: 0, perWindow: 0, windowMs: 3600_000 });
		configureHost('eth.blockscout.com', { minIntervalMs: 0, perWindow: 0, windowMs: 3600_000 });
		const kWait = await enqueue(evm(0x777), 25);
		const m2 = await processWatchQueue(sql, { http: { fetch, retries: 0 } });
		expect(m2.skipped.quota).toBe(1);
		expect((await queue(kWait)).status).toBe('pending');
	});

	it('an address looked back on is not queued again within the cache lifetime', async () => {
		const fetch = fakeExplorers({ txs: [] });
		const key = await enqueue(DEPOSITOR, 25);
		await processWatchQueue(sql, { http: { fetch, retries: 0 } });
		expect((await queue(key)).status).toBe('done');
		const again = await enqueueWatch(sql, [{ key, chain: 'ETH', address: DEPOSITOR, txid: 'Y', height: 28_000_100, date: DEPOSIT_TIME, usd: 90_000, asset: 'ETH.ETH', action: 'swap' }]);
		expect(again.queued).toBe(0);
		expect((await queue(key)).status).toBe('done');
	});

	it('Bitcoin: an input spent together with the deposit, or a funding transaction, from a listed address', async () => {
		const depositor = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
		const listedBtc = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
		await list(sql, [listed(`evm:${LISTED}`, LISTED), listed(`btc:${listedBtc}`, listedBtc, { chain: 'BTC' })]);
		const funding = utxoTx('ab01', T - 4000, [[listedBtc, 3e8]], [[depositor, 2.5e8]]);
		const deposit = utxoTx('ab02', T - 100, [[depositor, 2.5e8, 'ab01']], [['3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC', 2.4e8], [{ opReturn: '=:ETH.ETH:0x0000000000000000000000000000000000000001' }, 0]]);
		const esplora = new FakeEsplora([funding, deposit]);
		const fetch = fakeExplorers({ txs: [] }, esplora);
		const client = new Esplora('BTC', { hosts: ['https://esplora.test/api'], http: { fetch, retries: 0 } });
		const key = await enqueue(depositor, 70, 'BTC', 'BTC.BTC', 'AB02');
		const m = await processWatchQueue(sql, { http: { fetch, retries: 0 }, esplora: { BTC: client } });
		expect(m.hits).toBe(1);
		expect((await queue(key)).result).toMatchObject({ from: listedBtc, hop: 1 });
	});
});

describe('the follower queues, never blocks, and traced depositors are followed on THORChain', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	await list(sql, [listed(`evm:${LISTED}`, LISTED)]);
	const deposit = swapIn(DEPOSITOR, 20, 28_000_000);
	const midgard = new FakeMidgard([deposit], { 'ETH.ETH': 3_000, 'BTC.BTC': 90_000 });

	it('queues from the real-time tick; an enqueue failure never stops the tick', async () => {
		await setState(sql, 'trace:realtime', { height: 27_999_990 });
		const r = await runRealtimeTick(sql, midgard, { prices, watch: DEFAULT_WATCH_CONFIG });
		expect(r.watch).toEqual({ candidates: 1, queued: 1 });
		expect(r.to).toBe(28_000_000);
		// the queue table is gone (a failed migration, a dropped table): the tick still completes
		await sql.query(`ALTER TABLE oz_watch_queue RENAME TO oz_watch_queue_x`);
		await setState(sql, 'trace:realtime', { height: 27_999_990 });
		const r2 = await runRealtimeTick(sql, midgard, { prices, watch: DEFAULT_WATCH_CONFIG });
		expect(r2.watch?.error).toBeDefined();
		expect(r2.to).toBe(28_000_000);
		await sql.query(`ALTER TABLE oz_watch_queue_x RENAME TO oz_watch_queue`);
	});

	it('after a hit, the depositor\'s THORChain outputs are traced as usual', async () => {
		fastHosts();
		const fetch = fakeExplorers({ txs: [{ from: LISTED, to: DEPOSITOR, eth: 25, time: T - 3600 }] });
		const m = await processWatchQueue(sql, { http: { fetch, retries: 0 } });
		expect(m.hits).toBe(1);
		const b = await runTraceBackfill(sql, midgard, { prices, filter: (k) => k === `evm:${DEPOSITOR}` });
		expect(b.traced).toBe(1);
		const out = (await sql.query<{ hop: number; origin_key: string }>(`SELECT hop, origin_key FROM oz_traced WHERE key = $1`, [`btc:${BTC_OUT}`])).rows[0];
		expect(out).toMatchObject({ hop: 2, origin_key: `evm:${LISTED}` });
		// published: the depositor with its L1 funding reason (linked to the L1 explorer), its output one hop further
		const key = loadPrivateKey(generateSigningKey().seedHex);
		const pub = await publishSnapshot(sql, key, { coreSources: [] });
		expect(pub.published).toBe(true);
		const index = (await loadLatestIndex(sql))!;
		const v = index.screen(DEPOSITOR, 'ETH');
		expect(v.status).toBe('flagged');
		expect(v.reasons[0]).toMatchObject({ code: 'TRACE_L1_FUNDING', source: 'thorchain_trace', risk: 'high' });
		expect(v.reasons[0].ref).toMatch(/^https:\/\/etherscan\.io\/tx\/0x/);
		expect(v.reasons[0].trace).toMatchObject({ hop: 1, action: 'l1_funding', from: LISTED, originKey: `evm:${LISTED}` });
		const o = index.screen(BTC_OUT, 'BTC');
		expect(o.reasons[0]).toMatchObject({ code: 'TRACE_SWAP', risk: 'medium' });
		expect(o.reasons[0].trace?.hop).toBe(2);
		expect(o.reasons[0].ref).toMatch(/^https:\/\/runescan\.io\/tx\//);
	});
});

describe('outputs of already-traced keys to new L1 destinations', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('are traced by the real-time follower, one hop further', async () => {
		await list(sql, [listed(`evm:${LISTED}`, LISTED)]);
		// history: the listed address swapped into BTC_OUT at height 100 (traced at hop 1)
		const first = action({
			height: 100,
			in: [{ address: LISTED, asset: 'ETH.ETH', amount: 20 }],
			out: [{ address: BTC_OUT, asset: 'BTC.BTC', amount: 0.6 }],
			metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } }
		});
		const backfill = new FakeMidgard([first]);
		await runTraceBackfill(sql, backfill, { prices });
		const index = await loadTraceIndex(sql);
		expect(index.get(`btc:${BTC_OUT}`)).toMatchObject({ hop: 1 });
		// later, live: the traced BTC address swaps to a brand-new ETH address
		const fresh = evm(0xfe5);
		const later = action({
			height: 200,
			in: [{ address: BTC_OUT, asset: 'BTC.BTC', amount: 0.5 }],
			out: [{ address: fresh, asset: 'ETH.ETH', amount: 15 }],
			metadata: { swap: { inPriceUSD: '90000', outPriceUSD: '3000' } }
		});
		await setState(sql, 'trace:realtime', { height: 150 });
		const r = await runRealtimeTick(sql, new FakeMidgard([first, later]), { prices, index });
		expect(r.traced).toBe(1);
		const t = (await sql.query<{ hop: number; risk: string; origin_key: string }>(`SELECT hop, risk, origin_key FROM oz_traced WHERE key = $1`, [`evm:${fresh}`])).rows[0];
		expect(t).toMatchObject({ hop: 2, risk: 'medium', origin_key: `evm:${LISTED}` });
	});
});
