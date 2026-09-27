/**
 * Small transfers (each under the $50 dust limit) from a flagged address:
 * counted once per THORChain transaction however often the action is read,
 * and added up per (origin, recipient, hop).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { collectSnapshot } from '../src/snapshot/builder.js';
import { applySourceResult } from '../src/store/entries.js';
import { dustTotals, loadTraceIndex, recordDustFlows, recordHits, setState } from '../src/store/trace.js';
import { checkAddress, runRealtimeTick, runTraceBackfill } from '../src/trace/jobs.js';
import { DEFAULT_TRACE_CONFIG, type DustFlow, type TraceHit } from '../src/trace/tracer.js';
import { emptyResult, type Sql } from '../src/types.js';
import { action, FakeMidgard, memoryDb } from './helpers.js';

/** Lists `address` (ETH) as a hack origin at risk `high`. */
async function listOrigin(sql: Sql, address: string, entity = 'Small-transfer test origin') {
	const res = emptyResult();
	res.entries.push({
		source: 'ethlabels',
		key: `evm:${address}`,
		chain: 'ETH',
		address,
		category: 'hack',
		risk: 'high',
		code: 'HACK_LABEL',
		entity,
		text: 'test fixture'
	});
	await applySourceResult(sql, { id: 'ethlabels', name: 'eth-labels', kind: 'community' }, res);
}

/** A swap from `from` (ETH) to `to` (BTC) worth `usd` at the swap's own price. */
const swap = (height: number, from: string, to: string, usd: number, txID?: string) =>
	action({
		height,
		in: [{ address: from, asset: 'ETH.ETH', amount: 1, ...(txID ? { txID } : {}) }],
		out: [{ address: to, asset: 'BTC.BTC', amount: 1 }],
		metadata: { swap: { outPriceUSD: String(usd) } }
	});

/** Forces every flagged address's whole history to be read again (as after a lost cursor). */
const rereadEverything = (sql: Sql) => sql.query(`UPDATE oz_trace_checked SET status = 'pending', checked_height = 0`);

const totalFor = async (sql: Sql, originKey: string, toKey: string, hop = 1) =>
	(await dustTotals(sql)).find((d) => d.originKey === originKey && d.toKey === toKey && d.hop === hop);

describe('small transfers are counted once, however often an action is read', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const origin = '0x' + 'e1'.repeat(20);
	const originKey = `evm:${origin}`;
	const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
	const recipientKey = `btc:${recipient}`;
	const actions = [swap(100, origin, recipient, 30, 'REPLAYTX1')];

	it('backfill, real-time follower, a full re-read and a direct re-check of the same action add $30 once', async () => {
		await listOrigin(sql, origin);
		const midgard = new FakeMidgard(actions);

		// 1. the history backfill reads the listed address
		expect((await runTraceBackfill(sql, midgard)).errors).toBe(0);
		expect(await totalFor(sql, originKey, recipientKey)).toMatchObject({ usd: 30, count: 1 });

		// 2. the real-time follower sees the same action (its cursor was behind it)
		await setState(sql, 'trace:realtime', { height: 99 });
		await runRealtimeTick(sql, midgard);
		expect(await totalFor(sql, originKey, recipientKey)).toMatchObject({ usd: 30, count: 1 });

		// 3. a follower gap / weekly re-read makes the backfill read everything again
		await rereadEverything(sql);
		expect((await runTraceBackfill(sql, midgard)).checked).toBeGreaterThan(0);
		expect(await totalFor(sql, originKey, recipientKey)).toMatchObject({ usd: 30, count: 1 });

		// 4. a retry of the same check (e.g. after a crash before the cursor moved)
		const index = await loadTraceIndex(sql);
		const r = await checkAddress(midgard, originKey, 0, (k) => index.get(k), undefined, DEFAULT_TRACE_CONFIG);
		expect(r.dust).toHaveLength(1);
		await recordDustFlows(sql, r.dust);
		await recordDustFlows(sql, [...r.dust, ...r.dust]);
		expect(await totalFor(sql, originKey, recipientKey)).toMatchObject({ usd: 30, count: 1 });

		const rows = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_trace_dust_flows`);
		expect(rows.rows[0].n).toBe(1);
		// the superseded running-total table is no longer written
		const legacy = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_trace_dust_totals`);
		expect(legacy.rows[0].n).toBe(0);
	});

	it('a transfer read once as dust and once above the limit (another price) is counted once', async () => {
		const other = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
		const base = {
			txid: 'PRICEFLIP1',
			height: 200,
			date: new Date('2025-06-01').toISOString(),
			action: 'send',
			relation: 'value' as const,
			fromKey: originKey,
			fromAddress: origin,
			fromChain: 'ETH',
			toKey: `btc:${other}`,
			toAddress: other,
			toChain: 'BTC',
			hop: 1,
			originKey,
			originSource: 'ethlabels',
			originRisk: 'high' as const,
			originCategory: 'hack' as const
		};
		const asDust: DustFlow = { ...base, usd: 45 };
		const asEdge: TraceHit = { ...base, usd: 55, risk: 'medium' };
		await recordDustFlows(sql, [asDust]);
		expect(await totalFor(sql, originKey, `btc:${other}`)).toMatchObject({ usd: 45 });
		await recordHits(sql, [asEdge]);
		// now in the edge sums: the ledger side leaves it out
		expect(await totalFor(sql, originKey, `btc:${other}`)).toBeUndefined();
	});

	it('a replay from a lower hop moves the flow to that hop instead of counting it again', async () => {
		const to = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
		const flow: DustFlow = {
			txid: 'HOPMOVE1',
			height: 300,
			date: new Date('2025-06-02').toISOString(),
			action: 'send',
			relation: 'value',
			fromKey: 'thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh',
			fromAddress: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh',
			fromChain: 'THOR',
			toKey: `btc:${to}`,
			toAddress: to,
			toChain: 'BTC',
			usd: 20,
			hop: 3,
			originKey,
			originSource: 'ethlabels',
			originRisk: 'high',
			originCategory: 'hack'
		};
		await recordDustFlows(sql, [flow]);
		await recordDustFlows(sql, [{ ...flow, hop: 2 }]);
		await recordDustFlows(sql, [{ ...flow, hop: 3 }]); // a stale, higher-hop read changes nothing
		expect(await totalFor(sql, originKey, `btc:${to}`, 3)).toBeUndefined();
		expect(await totalFor(sql, originKey, `btc:${to}`, 2)).toMatchObject({ usd: 20, count: 1 });
	});
});

describe('small transfers add up with larger flows of the same (origin, recipient, hop)', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const origin = '0x' + 'e2'.repeat(20);
	const over = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
	const under = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

	it('$600 plus ten $45 transfers reaches $1,000 (high); $600 plus five stays medium, even when re-read', async () => {
		await listOrigin(sql, origin);
		const actions = [
			swap(400, origin, over, 600),
			...Array.from({ length: 10 }, (_, i) => swap(401 + i, origin, over, 45)),
			swap(500, origin, under, 600),
			...Array.from({ length: 5 }, (_, i) => swap(501 + i, origin, under, 45))
		];
		const midgard = new FakeMidgard(actions);
		expect((await runTraceBackfill(sql, midgard)).errors).toBe(0);
		// read the same history twice more: a counter would reach $1,275 for `under`
		for (let i = 0; i < 2; i++) {
			await rereadEverything(sql);
			await runTraceBackfill(sql, midgard);
		}

		const snap = await collectSnapshot(sql);
		const risks = (key: string) => snap.records.find((x) => x.key === key)?.reasons.map((r) => r.risk);
		expect(risks(`btc:${over}`)).toContain('high');
		expect(risks(`btc:${under}`)).toEqual(['medium']);
	});
});
