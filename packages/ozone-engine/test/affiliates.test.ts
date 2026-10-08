/**
 * Affiliate fee collectors are interface infrastructure, not owners
 * (store/affiliates.ts). On 2026-10-07, nine of the ten flagged thor1
 * addresses were collectors or owners behind the affiliate THORNames
 * `naswap`, `w1`/`wr` and `xdf`/`ct`: flagged through THORName links and
 * through a fee read from a streaming swap's refund action. These tests
 * replay those shapes (taken from Midgard, 2026-10-07) and the clean-up of
 * what earlier rules recorded.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { action, FakeMidgard, memoryDb } from './helpers.js';
import { extractFlows, memoRefundAddress } from '../src/trace/flows.js';
import { traceAction, DEFAULT_TRACE_CONFIG, type IndexEntry, type TraceHit } from '../src/trace/tracer.js';
import { StaticPrices } from '../src/trace/prices.js';
import { runRealtimeTick, PENDING_READS_PER_TICK, type PendingAction } from '../src/trace/jobs.js';
import {
	affiliateSet,
	classifyAffiliates,
	loadAffiliates,
	pruneTraceGraph,
	recordAffiliateObservations,
	type PruneResult
} from '../src/store/affiliates.js';
import { getState, loadTraceIndex, recordHits, setState } from '../src/store/trace.js';
import type { MidgardAction, MidgardLike } from '../src/trace/midgard.js';

const KELP = '0xc00f04a33ca521ca167903b5ae59810013ecb7af'; // KelpDAO cluster member (swapped ETH→BTC through THORChain)
const NASWAP = 'thor148sahwr5pg44cy0n23zwc723ugy2fptw0m8sau'; // the `naswap` THORName's collector
const BTC_DEST = 'bc1purt38m6qkzxa86yryrqag8hxs6wd8knuh4gquv0al265g7dfplkqz636ht';
const W1 = 'thor1awn7l5a8u9a7mlypcsgevrjfe2gtyhjwnsng25'; // the `w1` collector
const OWNER = 'thor14lkndecaw0zkzu0yq4a0qq869hrs8hh7uqjwf3'; // owner of the `wr` THORName
const prices = new StaticPrices(new Map(Object.entries({ 'THOR.RUNE': 0.77, 'ETH.ETH': 2400, 'BTC.BTC': 80_000 })));
const memo = `=:BTC.BTC:${BTC_DEST}:199343227/1/0:naswap:10`;

const listed = (key: string, risk: IndexEntry['originRisk'] = 'high'): IndexEntry => ({ key, hop: 0, originRisk: risk, originKey: key, originSource: 'cluster', originCategory: 'hack' });
const lookupOf = (entries: IndexEntry[]) => {
	const m = new Map(entries.map((e) => [e.key, e]));
	return (k: string) => m.get(k);
};

/** The streaming swap of 2026-04-22 (THORChain height 25,874,530): its swap action and its partial refund. */
function kelpSwap(): { swap: MidgardAction; refund: MidgardAction } {
	const outs = [
		{ address: NASWAP, asset: 'THOR.RUNE', amount: 285.53658857 },
		{ address: KELP, asset: 'ETH.ETH', amount: 8.05909644 },
		{ address: BTC_DEST, asset: 'BTC.BTC', amount: 1.75529432 }
	];
	const swap = action({
		type: 'swap',
		height: 25_874_530,
		in: [{ address: KELP, asset: 'ETH.ETH', amount: 59.1008, txID: '71EF0BD4' }],
		out: outs.map((o) => ({ ...o, affiliate: o.address === NASWAP })),
		metadata: { swap: { affiliateAddress: 'naswap', affiliateFee: '10', memo, inPriceUSD: '2408', outPriceUSD: '80478' } }
	});
	// Midgard repeats the swap's outputs in the refund action, without the affiliate flag
	const refund = action({
		type: 'refund',
		height: 25_874_554,
		in: [{ address: KELP, asset: 'ETH.ETH', amount: 8.0592, txID: '71EF0BD4' }],
		out: outs,
		metadata: { refund: { affiliateAddress: 'naswap', affiliateFee: '10', memo, reason: 'swap has been completed', txType: 'swap' } }
	});
	return { swap, refund };
}

describe('refund actions', () => {
	it('the fee collector of a streaming swap is not read as a recipient from its refund action', () => {
		const { swap, refund } = kelpSwap();
		const lookup = lookupOf([listed(`evm:${KELP}`)]);
		const fromSwap = traceAction(swap, lookup, prices);
		const fromRefund = traceAction(refund, lookup, prices);
		expect(fromSwap.map((h) => h.toAddress)).toEqual([BTC_DEST]);
		expect(fromRefund).toEqual([]);
	});

	it('a refund to the refund address the memo names, in the asset that was sent, is a flow', () => {
		const other = '0x2222222222222222222222222222222222222222';
		expect(memoRefundAddress(`=:BTC.BTC:${BTC_DEST}/${other}:0/1/0`)).toBe(other);
		expect(memoRefundAddress(memo)).toBeUndefined();
		const refund = action({
			type: 'refund',
			height: 100,
			in: [{ address: KELP, asset: 'ETH.ETH', amount: 10 }],
			out: [
				{ address: other, asset: 'ETH.ETH', amount: 9.9 },
				{ address: NASWAP, asset: 'THOR.RUNE', amount: 300 }
			],
			metadata: { refund: { memo: `=:BTC.BTC:${BTC_DEST}/${other}:0/1/0:naswap:10`, txType: 'swap' } }
		});
		expect(extractFlows(refund, prices).map((f) => f.toAddress)).toEqual([other]);
	});
});

describe('THORName links through affiliate infrastructure', () => {
	const alias = '0x259fe33b59ae7c24b34c0cb957271ae0f7786878';
	const thorname = (name: string, owner: string, chain: string, address: string) =>
		action({ type: 'thorname', height: 19_131_741, in: [{ address: owner, asset: 'THOR.RUNE', amount: 1 }], metadata: { thorname: { thorname: name, owner, chain, address } } });

	it('an ordinary THORName links its owner and alias (the same actor)', () => {
		const flows = extractFlows(thorname('mine', OWNER, 'ETH', alias), prices);
		expect(flows.map((f) => f.relation)).toEqual(['thorname', 'thorname']);
	});

	it('an affiliate THORName, or one that points at a fee collector, links nothing', () => {
		const known = affiliateSet([W1], ['wr']);
		expect(extractFlows(thorname('wr', OWNER, 'ETH', alias), prices, known)).toEqual([]);
		expect(extractFlows(thorname('other', OWNER, 'THOR', W1), prices, known)).toEqual([]);
		expect(extractFlows(thorname('mine', OWNER, 'ETH', alias), prices, known)).toHaveLength(2);
	});
});

describe('learning collectors and names', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('counts swaps that paid a collector; five make it one, with the name it was paid under', async () => {
		const swaps = Array.from({ length: 5 }, (_, i) => {
			const a = action({
				height: 1_000 + i,
				in: [{ address: `0x${String(i + 1).padStart(40, '0')}`, asset: 'ETH.ETH', amount: 1 }],
				out: [
					{ address: 'thor1wctk0k57q0000000000000000000000000000', asset: 'THOR.RUNE', amount: 1000 },
					{ address: W1, asset: 'THOR.RUNE', amount: 1, affiliate: true }
				],
				metadata: { swap: { affiliateAddress: 'w1', affiliateFee: '20', memo: '=:r:x:0:w1:20' } }
			});
			return a;
		});
		await recordAffiliateObservations(sql, swaps.slice(0, 4));
		expect((await loadAffiliates(sql)).isCollector(W1)).toBe(false);
		await recordAffiliateObservations(sql, swaps.slice(4));
		const known = await loadAffiliates(sql);
		expect(known.isCollector(W1)).toBe(true);
		expect(known.isName('w1')).toBe(true);
	});

	it('classifies traced thor1 accounts by their own history', async () => {
		await recordHits(sql, [hit({ fromKey: 'evm:0x' + '1'.repeat(40), toKey: `thor:${OWNER}`, relation: 'thorname', hop: 1, amount: 'THORName wr' })]);
		const fees = (n: number, to: string): MidgardAction[] =>
			Array.from({ length: n }, (_, i) =>
				action({ height: 2_000 + i, in: [{ address: `0x${String(i + 7).padStart(40, '0')}`, asset: 'ETH.ETH', amount: 1 }], out: [{ address: to, asset: 'THOR.RUNE', amount: 1, affiliate: true }] })
			);
		const midgard: MidgardLike = {
			...new FakeMidgard([]),
			actions: async (p: Record<string, string | number | undefined>) => ({ actions: p.address === OWNER ? fees(2, OWNER) : [] }),
			actionsForAddress: new FakeMidgard([]).actionsForAddress,
			actionsSince: new FakeMidgard([]).actionsSince,
			pools: async () => [],
			runePriceUsd: async () => 0
		};
		const r = await classifyAffiliates(sql, midgard);
		expect(r).toMatchObject({ checked: 1, collectors: 0 }); // two fees in its history: an owner, not a collector
		const again = await classifyAffiliates(sql, midgard);
		expect(again.checked).toBe(0); // classified this week
	});
});

let seq = 0;
function hit(p: Partial<TraceHit> & { fromKey: string; toKey: string }): TraceHit {
	seq++;
	const [ns, address] = p.toKey.split(':');
	return {
		txid: p.txid ?? `T${seq}`,
		height: p.height ?? 1_000 + seq,
		date: p.date ?? new Date(Date.UTC(2026, 3, 1) + seq * 60_000).toISOString(),
		action: p.action ?? 'send',
		relation: p.relation ?? 'value',
		fromKey: p.fromKey,
		fromAddress: p.fromKey.split(':')[1],
		fromChain: p.fromChain ?? (p.fromKey.startsWith('evm:') ? 'ETH' : p.fromKey.startsWith('btc:') ? 'BTC' : 'THOR'),
		toKey: p.toKey,
		toAddress: address,
		toChain: ns === 'evm' ? 'ETH' : ns.toUpperCase(),
		amount: p.amount ?? '5000 THOR.RUNE',
		usd: p.usd ?? 5_000,
		hop: p.hop ?? 1,
		risk: p.risk ?? 'high',
		originKey: p.originKey ?? 'evm:0x' + 'e'.repeat(40),
		originSource: 'cluster',
		originRisk: 'high',
		originCategory: 'hack'
	};
}

describe('pruning what earlier rules recorded', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const E = 'evm:0x' + 'e'.repeat(40); // a listed hack-cluster member
	const C = `thor:${W1}`; // a collector, linked by a THORName
	const N = `thor:${NASWAP}`; // a collector's fee, read from a refund
	const X = 'thor:thor1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.slice(0, 48);
	const Y = 'thor:thor1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy'.slice(0, 48);
	const M = 'thor:thor1mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm'.slice(0, 48);
	const Z = 'thor:thor1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'.slice(0, 48);
	const B = `btc:${BTC_DEST}`;

	it('removes refund fees and THORName links through collectors, with everything that hung only on them', async () => {
		await sql.query(
			`INSERT INTO oz_entries (source, key, chain, address, category, risk, code, reason) VALUES ('cluster', $1, 'ETH', $2, 'hack', 'high', 'HACK_CLUSTER', 'test')`,
			[E, E.slice(4)]
		);
		await recordHits(sql, [
			hit({ fromKey: E, toKey: B, action: 'swap', hop: 1, amount: '1.7 BTC.BTC', usd: 140_000 }), // a real flow
			hit({ fromKey: E, toKey: C, relation: 'thorname', action: 'thorname', hop: 1, amount: 'THORName wr', usd: undefined }),
			hit({ fromKey: C, toKey: X, hop: 2, risk: 'medium' }),
			hit({ fromKey: X, toKey: Y, hop: 3, risk: 'low' }),
			hit({ fromKey: E, toKey: N, action: 'refund', hop: 1, amount: '285.5366 THOR.RUNE', usd: 220 }),
			hit({ fromKey: N, toKey: M, hop: 2, risk: 'medium' }),
			hit({ fromKey: X, toKey: Z, hop: 3, risk: 'low' }),
			hit({ fromKey: B, toKey: Z, action: 'swap', hop: 2, risk: 'medium', usd: 9_000 }) // Z has another path
		]);
		await sql.query(`INSERT INTO oz_affiliates (address, receipts) VALUES ($1, 50)`, [W1]);
		const before = (await sql.query<{ key: string }>(`SELECT key FROM oz_traced ORDER BY key`)).rows.map((r) => r.key);
		expect(before).toEqual([B, C, M, N, X, Y, Z].sort());

		const r = await pruneTraceGraph(sql, await loadAffiliates(sql), { label: 'test' });
		expect(r.ruleEdges).toEqual({ refund: 1, infrastructure: 1 });
		expect(new Set(r.keys)).toEqual(new Set([C, X, Y, N, M]));
		const after = (await sql.query<{ key: string; hop: number }>(`SELECT key, hop FROM oz_traced ORDER BY key`)).rows;
		expect(after.map((x) => x.key)).toEqual([B, Z].sort());
		expect(after.find((x) => x.key === Z)?.hop).toBe(2); // rebuilt from its other edge
		const edges = (await sql.query<{ from_key: string; to_key: string }>(`SELECT from_key, to_key FROM oz_trace_edges ORDER BY from_key`)).rows;
		expect(edges).toEqual([
			{ from_key: B, to_key: Z },
			{ from_key: E, to_key: B }
		]);
		const audit = await getState<Array<PruneResult & { label?: string }>>(sql, 'trace:prune');
		expect(audit?.at(-1)).toMatchObject({ label: 'test', orphanedKeys: 5 });
		// idempotent
		expect((await pruneTraceGraph(sql, await loadAffiliates(sql))).edges).toBe(0);
		// a collector reached again is not followed onward — unless it is flagged high in its own
		// right (a large flow straight from a listing): fees are inflatable and exempt nobody
		const index = await loadTraceIndex(sql);
		await recordHits(sql, [hit({ fromKey: E, toKey: C, action: 'swap', hop: 2, risk: 'medium' })]);
		expect((await loadTraceIndex(sql)).get(C)?.service).toBe(true);
		await recordHits(sql, [hit({ fromKey: E, toKey: C, action: 'swap', hop: 1 })]);
		expect((await loadTraceIndex(sql)).get(C)?.service).toBeFalsy();
		expect(index.get(E)?.hop).toBe(0);
	});
});

describe('real-time follower', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('hands every action to discovery, learns collectors, and re-reads at most a few pending actions per tick', async () => {
		await setState(sql, 'trace:realtime', { height: 99 });
		const pending: PendingAction[] = Array.from({ length: 12 }, (_, i) => ({ txid: `P${i}`, height: 90, since: Date.now() }));
		await setState(sql, 'trace:pending', pending);
		const swaps = Array.from({ length: 5 }, (_, i) =>
			action({
				height: 100 + i,
				in: [{ address: `0x${String(i + 1).padStart(40, '0')}`, asset: 'ETH.ETH', amount: 1 }],
				out: [{ address: W1, asset: 'THOR.RUNE', amount: 1, affiliate: true }],
				metadata: { swap: { affiliateAddress: 'w1', affiliateFee: '20' } }
			})
		);
		const m = new FakeMidgard(swaps);
		let txidReads = 0;
		(m as unknown as { actions: (p: Record<string, unknown>) => Promise<{ actions: MidgardAction[] }> }).actions = async (p) => {
			if (p.txid) txidReads++;
			return { actions: [] };
		};
		const seen: number[] = [];
		await runRealtimeTick(sql, m, { prices, index: new Map(), onActions: (a) => seen.push(a.length) });
		expect(seen).toEqual([5]);
		expect(txidReads).toBe(PENDING_READS_PER_TICK);
		expect((await loadAffiliates(sql)).isCollector(W1)).toBe(true);
		// the ones read are not read again for two minutes; the others are next
		txidReads = 0;
		await runRealtimeTick(sql, m, { prices, index: new Map() });
		expect(txidReads).toBe(PENDING_READS_PER_TICK);
		const left = (await getState<PendingAction[]>(sql, 'trace:pending')) ?? [];
		expect(left.filter((p) => p.tried).length).toBe(2 * PENDING_READS_PER_TICK);
		void DEFAULT_TRACE_CONFIG;
	});
});
