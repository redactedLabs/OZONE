/**
 * Cluster expansion for every incident: the EVM and UTXO fan-outs with their
 * stop rules (window, value threshold, services, contracts, contract calls,
 * CoinJoins, THORChain deposits), budgets that cut a run short resumably,
 * the run planner, and the per-cluster store behind the `cluster` source.
 * Every network call is served by test/explorer-fakes.ts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
	Esplora,
	expandEvm,
	expandUtxo,
	planRun,
	runClusterExpansion,
	specHash,
	CHAIN_DEFAULTS,
	configureHost,
	loadTraceIndex,
	type ClusterSpec
} from '../src/index.js';
import { applySourceResult } from '../src/store/entries.js';
import { emptyResult } from '../src/types.js';
import { fakeExplorers, FakeEsplora, fastHosts, utxoTx, type FakeTx } from './explorer-fakes.js';
import { memoryDb } from './helpers.js';

const evm = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const T0 = Date.parse('2026-04-18T00:00:00Z') / 1000;
const DAY = 86_400;

const spec = (over: Partial<ClusterSpec> = {}): ClusterSpec => ({
	...CHAIN_DEFAULTS.ETH,
	id: 'test-2026:ETH',
	incident: 'test-2026',
	name: 'Test exploit (2026-04-18)',
	chain: 'ETH',
	entity: 'Test exploit (2026-04-18)',
	ref: 'https://example.org/post-mortem',
	window: { from: new Date(T0 * 1000).toISOString(), to: new Date((T0 + 30 * DAY) * 1000).toISOString() },
	risk: 'high',
	minValue: 1,
	maxDepth: 3,
	serviceTxThreshold: 5,
	...over
});

const SEED = evm(0x5eed);
const A = evm(0xa);
const B = evm(0xb);
const C = evm(0xc); // a contract
const D = evm(0xd);
const E = evm(0xe);
const R = evm(0x70); // a router (called with data)
const X = evm(0xf0); // a busy address (service)

function laundering(): FakeTx[] {
	const txs: FakeTx[] = [
		{ from: SEED, to: A, eth: 10, time: T0 + 100 }, // followed
		{ from: SEED, to: C, eth: 20, time: T0 + 200 }, // a contract: never listed
		{ from: SEED, to: D, eth: 0.1, time: T0 + 300 }, // under the threshold
		{ from: SEED, to: R, eth: 5, time: T0 + 400, input: '0x1fece7b4' }, // a contract call (router deposit)
		{ from: SEED, to: E, eth: 5, time: T0 - DAY }, // before the window
		{ from: A, to: B, eth: 9, time: T0 + 500 }, // depth 2
		{ from: A, to: X, eth: 1, time: T0 + 600 }, // depth 2, turns out to be a service
		{ from: B, to: evm(0xb2), eth: 4, time: T0 + 700 } // depth 3
	];
	for (let i = 0; i < 6; i++) txs.push({ from: X, to: evm(0x1000 + i), eth: 2, time: T0 + 800 + i }); // X: many outgoing
	return txs;
}

describe('EVM expansion', () => {
	beforeEach(() => fastHosts());

	it('follows plain transfers above the threshold inside the window; stops at contracts, calls and services', async () => {
		const fetch = fakeExplorers({ txs: laundering(), contracts: [C] });
		const r = await expandEvm(spec(), [SEED], { http: { fetch, retries: 0 }, now: (T0 + 40 * DAY) * 1000 });
		expect(r.truncated).toBe(false);
		const members = Object.fromEntries([...r.members.values()].map((m) => [m.address, m.depth]));
		expect(members).toEqual({ [A]: 1, [B]: 2, [evm(0xb2)]: 3 });
		expect([...r.contracts]).toEqual([C]);
		expect([...r.services]).toEqual([X]);
		expect(r.members.get(`evm:${A}`)).toMatchObject({ from: SEED, value: 10, chain: 'ETH' });
	});

	it('a request budget cuts a run short with its frontier, and a resumed run finishes it without duplicates', async () => {
		const fetch = fakeExplorers({ txs: laundering(), contracts: [C] });
		const s = spec();
		const first = await expandEvm(s, [SEED], { http: { fetch, retries: 0 }, maxRequests: 3, now: (T0 + 40 * DAY) * 1000 });
		expect(first.truncated).toBe(true);
		expect(first.stop).toBe('budget');
		expect(first.frontier.length).toBeGreaterThan(0);
		const known = [...first.members.values()].map((m) => m.address);
		const second = await expandEvm(s, [SEED], { http: { fetch, retries: 0 }, resume: { frontier: first.frontier, known }, now: (T0 + 40 * DAY) * 1000 });
		expect(second.truncated).toBe(false);
		// what the store keeps: both runs' members, minus what the second found to be a service
		const all = new Set([...known, ...[...second.members.values()].map((m) => m.address)].filter((a) => !second.services.has(a)));
		expect(all).toEqual(new Set([A, B, evm(0xb2)]));
		for (const m of second.members.values()) expect(known).not.toContain(m.address);
	});

	it('a spent provider quota stops the run resumably (never waits)', async () => {
		configureHost('api.routescan.io', { minIntervalMs: 0, perWindow: 3, windowMs: 3600_000 });
		configureHost('eth.blockscout.com', { minIntervalMs: 0, perWindow: 0, windowMs: 3600_000 });
		const fetch = fakeExplorers({ txs: laundering(), contracts: [C] });
		// a window of its own, so both block lookups use the quota (1 + 1), then the seed (1)
		const s = spec({ window: { from: new Date((T0 - 5) * 1000).toISOString(), to: new Date((T0 + 29 * DAY) * 1000).toISOString() } });
		const t = Date.now();
		const r = await expandEvm(s, [SEED], { http: { fetch, retries: 0 }, now: (T0 + 40 * DAY) * 1000, reserve: 0 });
		expect(Date.now() - t).toBeLessThan(2000);
		expect(r.truncated).toBe(true);
		expect(r.stop).toBe('quota');
		expect(r.frontier.map((f) => f.address)).toEqual([A]);
	});

	it('leaves a reserve of a quota\'d host to the watcher', async () => {
		configureHost('api.routescan.io', { minIntervalMs: 0, perWindow: 1_505, windowMs: 24 * 3600_000 });
		configureHost('eth.blockscout.com', { minIntervalMs: 0, perWindow: 0, windowMs: 3600_000 });
		const fetch = fakeExplorers({ txs: laundering(), contracts: [C] });
		const s = spec({ window: { from: new Date((T0 - 7) * 1000).toISOString(), to: new Date((T0 + 28 * DAY) * 1000).toISOString() } });
		const r = await expandEvm(s, [SEED], { http: { fetch, retries: 0 }, now: (T0 + 40 * DAY) * 1000 });
		// 2 block lookups + 3 nodes = 5 requests, then the last 1,500 stay for the watcher
		expect(r.stop).toBe('quota');
		expect(r.requests).toBe(5);
		const { evmTxList } = await import('../src/explorers/evm.js');
		const w = await evmTxList('ETH', A, { startblock: 0, endblock: 9_999_999_999, direction: 'to', maxPages: 1, http: { fetch, retries: 0 } });
		expect(w.txs.length).toBeGreaterThan(0); // the watcher (no reserve) still gets through
	});

	it('lists nobody whose contract status could not be read', async () => {
		const fetch = fakeExplorers({ txs: laundering(), contracts: [C], rpcDown: true });
		const r = await expandEvm(spec({ maxDepth: 1 }), [SEED], { http: { fetch, retries: 0 }, now: (T0 + 40 * DAY) * 1000 });
		expect(r.members.size).toBe(0);
		expect(r.skipped.codeUnknown).toBe(2); // A and C
	});
});

describe('UTXO expansion (Esplora)', () => {
	beforeEach(() => fastHosts());
	const S = 'bc1qseed0000000000000000000000000000000000';
	it('follows spends to new outputs; skips change, THORChain deposits, CoinJoins and services', async () => {
		const seed = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
		const next1 = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
		const next2 = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
		const vault = '3QJmV3qfvL9SuYo34YihAf3sRCW3qSinyC';
		const busy = '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';
		const jn = (i: number) => `bc1q${'x'.repeat(0)}` + i; // placeholders never parsed (CoinJoin outputs)
		const txs = [
			utxoTx('t1', T0 + 10, [[seed, 5e8]], [[next1, 3e8], [seed, 1.9e8]]), // change back to the seed
			utxoTx('t2', T0 + 20, [[seed, 2e8]], [[vault, 2e8], [{ opReturn: '=:ETH.ETH:0x0000000000000000000000000000000000000001' }, 0]]), // a THORChain deposit
			utxoTx('t3', T0 + 30, [[next1, 3e8]], [[next2, 2.9e8]]),
			utxoTx('t4', T0 + 40, [[next1, 1e6]], [[busy, 0.9e6]]), // under the threshold
			utxoTx('t5', T0 + 50, [[seed, 1e8], [jn(1), 1e8], [jn(2), 1e8], [jn(3), 1e8], [jn(4), 1e8]], [[jn(5), 1e8], [jn(6), 1e8], [jn(7), 1e8], [jn(8), 1e8], [jn(9), 1e8]]) // CoinJoin
		];
		const esplora = new FakeEsplora(txs, { [next2]: 10_000 });
		const fetch = fakeExplorers({ txs: [] }, esplora);
		const client = new Esplora('BTC', { hosts: ['https://esplora.test/api'], http: { fetch, retries: 0 } });
		const r = await expandUtxo({ ...spec({ chain: 'BTC', minValue: 0.02, serviceTxThreshold: 300, maxDepth: 3 }), id: 'test:BTC' }, [seed], {
			esplora: client,
			now: (T0 + 40 * DAY) * 1000
		});
		// next2 received from next1 but has 10,000 transactions: a service, never listed
		const members = Object.fromEntries([...r.members.values()].map((m) => [m.address, m.depth]));
		expect(members).toEqual({ [next1]: 1 });
		expect([...r.services]).toEqual([next2]);
		expect(r.skipped.deposits).toBe(1);
		expect(r.skipped.coinjoins).toBe(1);
		void S;
	});
});

describe('run planner', () => {
	const s = spec({ window: { from: '2026-04-18T00:00:00Z', to: '2026-10-15T00:00:00Z' } });
	const now = Date.parse('2026-09-28T00:00:00Z');
	const WEEK = 7 * DAY * 1000;
	const run = (over: Record<string, unknown> = {}) => ({
		cluster: s.id,
		ran_at: new Date(now - DAY * 1000),
		complete: true,
		params_hash: specHash(s),
		window_to: null,
		seeds: [SEED],
		frontier: [],
		...over
	});
	it('adopts earlier results, resumes cut-short runs, expands added seeds, and re-runs open windows weekly', () => {
		expect(planRun(s, [SEED], undefined, true, now, WEEK)).toEqual({ mode: 'adopt' });
		expect(planRun(s, [SEED], undefined, false, now, WEEK)).toEqual({ mode: 'full' });
		expect(planRun(s, [SEED], run({ params_hash: 'other' }), true, now, WEEK)).toEqual({ mode: 'full' });
		expect(planRun(s, [SEED], run({ complete: false, frontier: [{ address: A, depth: 1 }] }), true, now, WEEK)).toEqual({ mode: 'resume', frontier: [{ address: A, depth: 1 }] });
		expect(planRun(s, [SEED, B], run(), true, now, WEEK)).toEqual({ mode: 'incremental', frontier: [{ address: B, depth: 0 }] });
		expect(planRun(s, [B], run(), true, now, WEEK)).toEqual({ mode: 'full' }); // a seed removed
		expect(planRun(s, [SEED], run(), true, now, WEEK).mode).toBe('skip'); // ran yesterday
		expect(planRun(s, [SEED], run({ ran_at: new Date(now - 8 * DAY * 1000) }), true, now, WEEK)).toEqual({ mode: 'full' }); // open window, a week later
		const closed = spec({ window: { from: '2025-01-01T00:00:00Z', to: '2025-03-01T00:00:00Z' } });
		expect(planRun(closed, [SEED], { ...run(), params_hash: specHash(closed), ran_at: new Date(now - 60 * DAY * 1000) }, true, now, WEEK)).toEqual({
			mode: 'skip',
			why: 'complete (window closed)'
		});
	});
});

describe('cluster runs: per-cluster store, union source, delisting', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	beforeEach(() => fastHosts());
	const now = new Date((T0 + 40 * DAY) * 1000);
	const s1 = spec({ seeds: [SEED] });
	const s2 = spec({ id: 'other-2026:ETH', incident: 'other-2026', name: 'Other hack (2026-04-18)', entity: 'Other hack (2026-04-18)', seeds: [evm(0x7777)] });
	const txs = [...laundering(), { from: evm(0x7777), to: evm(0x7778), eth: 3, time: T0 + 50 }, { from: evm(0x7777), to: evm(0x7779), eth: 3, time: T0 + 60 }];

	it('stores each cluster, publishes the union with the incident named, and skips what is not due', async () => {
		const fetch = fakeExplorers({ txs, contracts: [C] });
		const r = await runClusterExpansion(sql, { specs: [s1, s2], http: { fetch, retries: 0 }, now });
		expect(r.ok).toBe(true);
		expect(r.runs.map((x) => [x.cluster, x.status]).sort()).toEqual([
			['other-2026:ETH', 'complete'],
			['test-2026:ETH', 'complete']
		]);
		const entries = await sql.query<{ key: string; entity: string; risk: string; meta: Record<string, unknown>; reason: string }>(
			`SELECT key, entity, risk, meta, reason FROM oz_entries WHERE source = 'cluster' AND removed_at IS NULL ORDER BY key`
		);
		expect(entries.rows.map((e) => e.key)).toEqual([`evm:${A}`, `evm:${B}`, `evm:${evm(0xb2)}`, `evm:${evm(0x7778)}`, `evm:${evm(0x7779)}`].sort());
		const a = entries.rows.find((e) => e.key === `evm:${A}`)!;
		expect(a).toMatchObject({ entity: 'Test exploit (2026-04-18)', risk: 'high' });
		expect(a.meta).toMatchObject({ cluster: 'test-2026:ETH', incident: 'test-2026', depth: 1, since: s1.window.from });
		expect(a.reason).toMatch(/^Test exploit \(2026-04-18\): received 10 ETH from 0x/);
		expect(entries.rows.find((e) => e.key === `evm:${evm(0xb2)}`)!.risk).toBe('medium'); // depth 3
		// the tracer counts cluster members from their incident's start
		const index = await loadTraceIndex(sql);
		expect(index.get(`evm:${A}`)?.sinceTime).toBe(T0);
		// nothing due a day later
		const again = await runClusterExpansion(sql, { specs: [s1, s2], http: { fetch, retries: 0 }, now: new Date(now.getTime() + DAY * 1000) });
		expect(again.runs.every((x) => x.status === 'skipped')).toBe(true);
	});

	it('a run cut short keeps what earlier runs found; an incident removed delists its members', async () => {
		const fetch = fakeExplorers({ txs, contracts: [C] });
		const forced = await runClusterExpansion(sql, { specs: [s1, s2], http: { fetch, retries: 0 }, now, force: true, maxRequests: 2, only: (x) => x.id === s1.id });
		expect(forced.runs.find((x) => x.cluster === s1.id)?.status).toBe('partial');
		const active = async () => (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_entries WHERE source = 'cluster' AND removed_at IS NULL`)).rows[0].n;
		expect(await active()).toBe(5);
		const runRow = (await sql.query<{ complete: boolean; stop: string; frontier: unknown[] }>(`SELECT complete, stop, frontier FROM oz_cluster_runs WHERE cluster = $1`, [s1.id])).rows[0];
		expect(runRow).toMatchObject({ complete: false, stop: 'budget' });
		expect(runRow.frontier.length).toBeGreaterThan(0);
		// the other incident leaves the dataset: its members are delisted, history kept
		const r = await runClusterExpansion(sql, { specs: [s1], http: { fetch, retries: 0 }, now });
		expect(r.ok).toBe(true);
		expect(await active()).toBe(3);
		const gone = await sql.query<{ removed_at: string | null }>(`SELECT removed_at FROM oz_entries WHERE source = 'cluster' AND key = $1`, [`evm:${evm(0x7778)}`]);
		expect(gone.rows[0].removed_at).not.toBeNull();
	});

	it('adopts clusters expanded before pass E (migration 0005 seeds them) instead of redoing them', async () => {
		const { db: db2, sql: sql2 } = await memoryDb();
		const pre = emptyResult();
		pre.entries.push({
			source: 'cluster',
			key: `evm:${evm(0xbb01)}`,
			chain: 'ETH',
			address: evm(0xbb01),
			category: 'hack',
			risk: 'high',
			code: 'HACK_CLUSTER',
			entity: 'Bybit hack laundering cluster',
			text: 'old',
			refId: '0xtx',
			listedAt: '2025-02-22T00:00:00Z',
			meta: { cluster: 'bybit-2025', depth: 1, from: evm(0x1), valueEth: 12 }
		});
		await applySourceResult(sql2, { id: 'cluster', name: 'cluster', kind: 'derived', maxDropRatio: 0.5 }, pre);
		const { migrate } = await import('../src/store/db.js');
		await migrate(sql2);
		await migrate(sql2); // re-runnable
		const seeded = await sql2.query<{ cluster: string; depth: number; value: number }>(`SELECT cluster, depth, value FROM oz_cluster_members`);
		expect(seeded.rows).toEqual([{ cluster: 'bybit-2025', depth: 1, value: 12 }]);
		const bybit = spec({ id: 'bybit-2025', incident: 'bybit-2025', seeds: [SEED] });
		const fetch = fakeExplorers({ txs: [] });
		const r = await runClusterExpansion(sql2, { specs: [bybit], http: { fetch, retries: 0 }, now });
		expect(r.runs[0]).toMatchObject({ status: 'adopted', members: 1, requests: 0 });
		const still = await sql2.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_entries WHERE source = 'cluster' AND removed_at IS NULL`);
		expect(still.rows[0].n).toBe(1);
		await db2.close();
	});
});

describe('explorer keys', () => {
	it('uses a routescan key when set (more capacity), Etherscan only for chains its tier covers', async () => {
		fastHosts();
		const { evmProviders, resetHostBudgets } = await import('../src/index.js');
		resetHostBudgets();
		const keyed = evmProviders('ETH', { ROUTESCAN_API_KEY: 'rk' });
		expect(keyed.map((p) => p.name)).toEqual(['routescan', 'blockscout']);
		expect(keyed[0].params).toEqual({ apikey: 'rk' });
		expect(keyed[0].budget.policy.perWindow).toBe(90_000);
		expect(evmProviders('BASE', { ETHERSCAN_API_KEY: 'ek' }).map((p) => p.name)).toEqual(['blockscout']); // free tier excludes Base
		expect(evmProviders('BASE', { ETHERSCAN_API_KEY: 'ek', ETHERSCAN_PAID: '1' }).map((p) => p.name)).toEqual(['etherscan', 'blockscout']);
		expect(evmProviders('BSC', {}).map((p) => p.name)).toEqual([]);
		resetHostBudgets();
	});
});
