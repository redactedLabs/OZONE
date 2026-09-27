import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { applySourceResult } from '../src/store/entries.js';
import { loadTraceIndex, pendingChecks, queryForms, recordHits } from '../src/store/trace.js';
import { toChecksumAddress } from '../src/util/evm.js';
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

	it('an affiliate-address match only suppresses an output within the declared fee', () => {
		const dest = 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';
		const swap = (outAmount: number) =>
			action({
				height: 101,
				in: [{ address: '0xaaaa000000000000000000000000000000000009', asset: 'ETH.ETH', amount: 100 }],
				out: [{ address: dest, asset: 'THOR.RUNE', amount: outAmount }],
				metadata: { swap: { affiliateAddress: dest, affiliateFee: '10', inPriceUSD: '3000', outPriceUSD: '1.5' } }
			});
		// input value ~$300,000; a 10 bps (0.1%) fee ceiling (x1.1) is ~$330.
		// The swapper named the swap's own destination as affiliate, but this
		// output ($30,000) is far larger than the declared fee: trace it.
		expect(extractFlows(swap(20_000))).toHaveLength(1);
		// A genuinely small output within the declared fee stays excluded.
		expect(extractFlows(swap(200))).toEqual([]);
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

	it('THORName owner/alias links require the owner to be the registering signer', () => {
		const metadata = {
			thorname: {
				thorname: 'laundry2',
				owner: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
				address: '0x098b716b8aaf21512996dc57eb0615e2383e2f96',
				chain: 'ETH'
			}
		};
		// Anyone can register a THORName and name an uninvolved address as
		// `owner`: the registrant here is not the owner, so no link is proven.
		const registeredByOther = action({
			type: 'thorname',
			height: 301,
			in: [{ address: 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh', asset: 'THOR.RUNE', amount: 11 }],
			metadata
		});
		expect(extractFlows(registeredByOther)).toEqual([]);
		// The named owner itself pays the registration fee: a verified link.
		const selfRegistered = action({
			type: 'thorname',
			height: 302,
			in: [{ address: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55', asset: 'THOR.RUNE', amount: 11 }],
			metadata
		});
		expect(extractFlows(selfRegistered).map((x) => x.relation)).toEqual(['thorname', 'thorname']);
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

	it('backfills history: queries the sender form, flags hop 1, then follows hop 2', async () => {
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
		// senders are stored lower-case by Midgard: that form is what forward tracing needs
		expect(midgard.requests).toContain(EXPLOITER_65);
		expect(queryForms(`evm:${EXPLOITER_65}`, toChecksumAddress, true)).toEqual([EXPLOITER_65, toChecksumAddress(EXPLOITER_65)]);
		expect(queryForms('bch:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', toChecksumAddress, true)).toEqual([
			'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
			'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
		]);

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

	it('hack-cluster members are tainted from the start of their incident, not before', async () => {
		const member = '0xdddd000000000000000000000000000000000004';
		const res = emptyResult();
		res.entries.push(
			entry(`evm:${member}`, member, {
				source: 'cluster',
				code: 'HACK_CLUSTER',
				entity: 'Bybit hack laundering cluster',
				text: 'received 50 ETH from a Bybit exploiter address on 2025-02-24',
				listedAt: '2025-02-24T10:00:00.000Z',
				meta: { cluster: 'bybit-2025', depth: 1 }
			})
		);
		await applySourceResult(sql, { id: 'cluster', name: 'Hack clusters', kind: 'derived' }, res);
		const index = await loadTraceIndex(sql);
		// the Bybit window opens on 2025-02-21 (the hack)
		expect(index.get(`evm:${member}`)?.sinceTime).toBe(Date.parse('2025-02-21T00:00:00Z') / 1000);
		const swap = (date: string, to: string) =>
			action({
				height: 19_000_000,
				date,
				in: [{ address: member, asset: 'ETH.ETH', amount: 10 }],
				out: [{ address: to, asset: 'BTC.BTC', amount: 0.3 }]
			});
		const lookup = (k: string) => index.get(k);
		// a year before it received the stolen funds: unrelated activity
		expect(traceAction(swap('2024-02-01T00:00:00Z', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), lookup, prices)).toEqual([]);
		// after the hack — even before the one transfer the expansion recorded
		// (members are often funded earlier through contracts): the proceeds
		const hits = traceAction(swap('2025-02-23T00:00:00Z', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), lookup, prices);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ hop: 1, risk: 'high', originSource: 'cluster' });
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

	it('real-time follower: a streaming swap reported as pending is re-read until it settles', async () => {
		const pendingSwap = action({
			height: 30000002,
			status: 'pending',
			in: [{ address: EXPLOITER_65, asset: 'ETH.ETH', amount: 50, txID: 'STREAMTX1' }],
			out: []
		});
		const settled = { ...pendingSwap, status: 'success', out: [{ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', coins: [{ asset: 'BTC.BTC', amount: String(1.5e8) }], txID: '' }], metadata: { swap: { outPriceUSD: '90000' } } } as MidgardAction;
		const m = new FakeMidgard([pendingSwap]);
		const t1 = await runRealtimeTick(sql, m, { prices });
		expect(t1.hits).toBe(0);
		// the swap settles; the follower has already moved past its height
		const m2 = new FakeMidgard([settled]);
		(m2 as unknown as { actions: (p: Record<string, unknown>) => Promise<{ actions: MidgardAction[] }> }).actions = async (p) =>
			p.txid === 'STREAMTX1' ? { actions: [settled] } : { actions: [settled] };
		const t2 = await runRealtimeTick(sql, m2, { prices });
		expect(t2.hits).toBe(1);
		const row = await sql.query(`SELECT hop, risk FROM oz_traced WHERE key = 'btc:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'`);
		expect(row.rows[0]).toMatchObject({ hop: 1, risk: 'high' });
	});

	it('pending checks: highest risk first, never beyond the hop limit', async () => {
		const index = await loadTraceIndex(sql);
		const tasks = await pendingChecks(sql, index, DEFAULT_TRACE_CONFIG.maxHops);
		expect(tasks.every((t) => t.hop < DEFAULT_TRACE_CONFIG.maxHops)).toBe(true);
		for (let i = 1; i < tasks.length; i++) expect(tasks[i - 1].priority).toBeGreaterThanOrEqual(tasks[i].priority);
	});
});
