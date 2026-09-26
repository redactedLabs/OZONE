import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { applySourceResult } from '../src/store/entries.js';
import { loadTraceIndex, pendingChecks, recordHits } from '../src/store/trace.js';
import { extractFlows } from '../src/trace/flows.js';
import { runRealtimeTick, runTraceBackfill } from '../src/trace/jobs.js';
import type { MidgardAction } from '../src/trace/midgard.js';
import { StaticPrices } from '../src/trace/prices.js';
import { DEFAULT_TRACE_CONFIG, traceAction, traceRisk, type IndexEntry } from '../src/trace/tracer.js';
import { emptyResult, type ListEntry } from '../src/types.js';
import { action, FakeMidgard, memoryDb } from './helpers.js';

const bybitActions = JSON.parse(
	readFileSync(new URL('./fixtures/midgard-bybit-exploiter-actions.json', import.meta.url), 'utf8')
) as Record<string, MidgardAction[]>;

const prices = new StaticPrices(
	new Map([
		['THOR.RUNE', 1.5],
		['BTC.BTC', 90_000],
		['ETH.ETH', 3_000]
	])
);

const EXPLOITER_65 = '0xb21e59b3d4e4d6c5247325dc5fbedbc89afc69f4';
const listed = (key: string, extra: Partial<IndexEntry> = {}): IndexEntry => ({
	key,
	hop: 0,
	originRisk: 'high',
	originKey: key,
	originSource: 'ethlabels',
	originEntity: 'Bybit Exploiter 65',
	originCategory: 'hack',
	...extra
});

describe('flow extraction (real Midgard actions)', () => {
	it('an L1→L1 Bybit swap (ETH → BTC, no thor1 involved) yields a flow to the BTC address', () => {
		const flows = extractFlows(bybitActions[EXPLOITER_65][0]);
		expect(flows).toHaveLength(1);
		expect(flows[0]).toMatchObject({
			relation: 'value',
			fromKey: `evm:${EXPLOITER_65}`,
			toKey: 'btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE',
			toChain: 'BTC',
			action: 'swap'
		});
		expect(flows[0].txid).toMatch(/^6F708AFC717FCE07/);
		expect(flows[0].amount).toBe('1.2133 BTC.BTC');
		expect(flows[0].usd).toBeGreaterThan(50_000); // priced with the swap's own outPriceUSD
		expect(flows[0].date.startsWith('2025-02-25')).toBe(true);
	});
});

describe('flow extraction (synthetic edge cases)', () => {
	it('skips affiliate outputs, module accounts, refunds and failed actions', () => {
		const a = action({
			height: 100,
			in: [{ address: '0xaaaa000000000000000000000000000000000001', asset: 'ETH.ETH', amount: 10 }],
			out: [
				{ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', asset: 'BTC.BTC', amount: 0.3 },
				{ address: 'thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l', asset: 'THOR.RUNE', amount: 20, affiliate: true },
				{ address: 'thor1dl7un46w7l7f3ewrnrm6nq58nerjtp0dradjtd', asset: 'THOR.RUNE', amount: 5 },
				{ address: '0xaaaa000000000000000000000000000000000001', asset: 'ETH.ETH', amount: 0.01 }
			]
		});
		const flows = extractFlows(a, prices);
		expect(flows.map((f) => f.toKey)).toEqual(['btc:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4']);
		expect(extractFlows({ ...a, status: 'failed' })).toEqual([]);
	});

	it('addLiquidity links the asset and RUNE sides; THORNames link owner and alias', () => {
		const add = action({
			type: 'addLiquidity',
			height: 200,
			in: [
				{ address: '0xbbbb000000000000000000000000000000000002', asset: 'ETH.ETH', amount: 5 },
				{ address: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', asset: 'THOR.RUNE', amount: 10_000 }
			]
		});
		const f = extractFlows(add, prices);
		expect(f.map((x) => `${x.relation}:${x.fromKey}>${x.toKey}`).sort()).toEqual([
			'lp_pair:evm:0xbbbb000000000000000000000000000000000002>thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh',
			'lp_pair:thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh>evm:0xbbbb000000000000000000000000000000000002'
		]);
		const tn = action({
			type: 'thorname',
			height: 300,
			in: [{ address: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', asset: 'THOR.RUNE', amount: 11 }],
			metadata: {
				thorname: {
					thorname: 'laundry',
					owner: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh',
					address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
					chain: 'BTC'
				}
			}
		});
		expect(extractFlows(tn).map((x) => x.relation)).toEqual(['thorname', 'thorname']);
	});
});

describe('risk decay and thresholds', () => {
	it('caps at high, decays per hop, ignores dust, downgrades small flows', () => {
		expect(traceRisk('severe', 1, 50_000, 'value')).toBe('high');
		expect(traceRisk('severe', 2, 50_000, 'value')).toBe('medium');
		expect(traceRisk('severe', 3, 50_000, 'value')).toBe('low');
		expect(traceRisk('severe', 4, 50_000, 'value')).toBeNull(); // hop limit
		expect(traceRisk('severe', 1, 20, 'value')).toBeNull(); // dust
		expect(traceRisk('severe', 1, 500, 'value')).toBe('medium'); // small hop-1 flow
		expect(traceRisk('medium', 2, 50_000, 'value')).toBe('low'); // phishing origin
		expect(traceRisk('medium', 3, 50_000, 'value')).toBeNull();
		expect(traceRisk('high', 1, undefined, 'lp_pair')).toBe('high');
	});

	it('only propagates flows after the taint height and never from services', () => {
		const traced: IndexEntry = { ...listed('btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE'), hop: 1, since: 20012046 };
		const before = action({
			height: 20000000,
			in: [{ address: '19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE', asset: 'BTC.BTC', amount: 1 }],
			out: [{ address: '0xcccc000000000000000000000000000000000003', asset: 'ETH.ETH', amount: 30 }]
		});
		const after = { ...before, height: '20100000' };
		const lookup = (k: string) => (k === traced.key ? traced : undefined);
		expect(traceAction(before, lookup, prices)).toEqual([]);
		const hits = traceAction(after, lookup, prices);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ hop: 2, risk: 'medium', toKey: 'evm:0xcccc000000000000000000000000000000000003' });
		expect(traceAction(after, (k) => (k === traced.key ? { ...traced, service: true } : undefined), prices)).toEqual([]);
	});
});

describe('trace store + backfill against an embedded Postgres', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const entry = (key: string, address: string, extra: Partial<ListEntry> = {}): ListEntry => ({
		source: 'ethlabels',
		key,
		chain: 'ETH',
		address,
		category: 'hack',
		risk: 'high',
		code: 'HACK_LABEL',
		entity: 'Bybit Exploiter 65',
		text: 'Etherscan label "Bybit Exploiter 65"',
		...extra
	});

	it('backfills history: queries EVM seeds in both cases, flags hop 1, then follows hop 2', async () => {
		const res = emptyResult();
		res.entries.push(entry(`evm:${EXPLOITER_65}`, EXPLOITER_65));
		await applySourceResult(sql, { id: 'ethlabels', name: 'eth-labels', kind: 'community' }, res);

		const hop2 = action({
			height: 20100000,
			in: [{ address: '19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE', asset: 'BTC.BTC', amount: 1.2 }],
			out: [{ address: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', asset: 'THOR.RUNE', amount: 70_000 }]
		});
		const midgard = new FakeMidgard([...bybitActions[EXPLOITER_65], hop2], { 'THOR.RUNE': 1.5, 'BTC.BTC': 90_000 });
		const r = await runTraceBackfill(sql, midgard);
		expect(r.errors).toBe(0);
		expect(r.traced).toBe(2);
		// the checksummed form was queried too (Midgard is case-sensitive)
		expect(midgard.requests.some((q) => q !== q.toLowerCase() && q.toLowerCase() === EXPLOITER_65)).toBe(true);

		const traced = await sql.query<{ key: string; hop: number; risk: string; first_txid: string }>(`SELECT key, hop, risk, first_txid FROM oz_traced ORDER BY hop`);
		expect(traced.rows.map((t) => [t.key, t.hop, t.risk])).toEqual([
			['btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE', 1, 'high'],
			['thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', 2, 'medium']
		]);
		const edge = await sql.query<{ reason: string }>(`SELECT reason FROM oz_trace_edges WHERE to_key = 'btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE'`);
		expect(edge.rows[0].reason).toMatch(/^Received 1\.2133 BTC\.BTC \(~\$[\d,]+\) from 0xb21e59b3d4e4d6c5247325dc5fbedbc89afc69f4, listed by Bybit Exploiter 65 \(ethlabels\) via THORChain swap .+ on 2025-02-25$/);

		// nothing left to do; a second run is a no-op
		const again = await runTraceBackfill(sql, midgard);
		expect(again.checked).toBe(0);
	});

	it('keeps the best reason per address (lower hop wins)', async () => {
		const index = await loadTraceIndex(sql);
		const t = index.get('thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh')!;
		expect(t.hop).toBe(2);
		// a direct (hop-1) flow from the listed exploiter arrives later
		const direct = action({
			height: 20200000,
			in: [{ address: EXPLOITER_65, asset: 'ETH.ETH', amount: 20 }],
			out: [{ address: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', asset: 'THOR.RUNE', amount: 40_000 }],
			metadata: { swap: { inPriceUSD: '2500', outPriceUSD: '1.5' } }
		});
		await recordHits(sql, traceAction(direct, (k) => index.get(k), prices));
		const row = await sql.query<{ hop: number; risk: string; edges: number }>(
			`SELECT hop, risk, edges FROM oz_traced WHERE key = 'thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh'`
		);
		expect(row.rows[0]).toMatchObject({ hop: 1, risk: 'high', edges: 2 });
	});

	it('real-time follower: starts at the head, then traces new actions from flagged addresses', async () => {
		const later = action({
			height: 30000001,
			in: [{ address: EXPLOITER_65, asset: 'ETH.ETH', amount: 3 }],
			out: [{ address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', asset: 'BTC.BTC', amount: 0.1 }],
			metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } }
		});
		const head = action({ height: 30000000, in: [{ address: 'thor1abc', asset: 'THOR.RUNE', amount: 1 }] });
		const m1 = new FakeMidgard([head]);
		const first = await runRealtimeTick(sql, m1);
		expect(first).toMatchObject({ from: 30000000, processed: 0 });
		const m2 = new FakeMidgard([head, later]);
		const tick = await runRealtimeTick(sql, m2, { prices });
		expect(tick).toMatchObject({ processed: 1, hits: 1, traced: 1, to: 30000001 });
		const t = await sql.query(`SELECT hop, risk FROM oz_traced WHERE key LIKE 'btc:bc1qrp33%'`);
		expect(t.rows[0]).toMatchObject({ hop: 1, risk: 'high' });
	});

	it('pending checks: highest risk first, never beyond the hop limit', async () => {
		const index = await loadTraceIndex(sql);
		const tasks = await pendingChecks(sql, index, DEFAULT_TRACE_CONFIG.maxHops);
		expect(tasks.every((t) => t.hop < DEFAULT_TRACE_CONFIG.maxHops)).toBe(true);
		for (let i = 1; i < tasks.length; i++) expect(tasks[i - 1].priority).toBeGreaterThanOrEqual(tasks[i].priority);
	});
});
