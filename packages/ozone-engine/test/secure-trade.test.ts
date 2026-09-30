/**
 * Secured-asset moves (SECURE+ / SECURE-) and trade-account moves (TRADE+ /
 * TRADE-) in the tracer. Midgard lists each as one action (`secure`, `trade`)
 * with the payer in `in` and the payee in `out`; test/fixtures/
 * midgard-secure-trade-actions.json holds real ones (gateway.liquify.com,
 * 2026-09-30). Both already followed the generic payer → payee rule: the live
 * snapshot of that day carries TRACE_TRADE reasons, and of the 2,000 most
 * recent `secure` and `trade` actions the only flows out of a key in it came
 * from accounts at the hop limit (nothing to flag beyond it). What these
 * tests add is the proof for each direction, their own reason texts and
 * codes, and the dust and hop rules on them.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { applySourceResult } from '../src/store/entries.js';
import { collectSnapshot } from '../src/snapshot/builder.js';
import { loadTraceIndex } from '../src/store/trace.js';
import { extractFlows } from '../src/trace/flows.js';
import { runRealtimeTick, runTraceBackfill } from '../src/trace/jobs.js';
import type { MidgardAction } from '../src/trace/midgard.js';
import { StaticPrices } from '../src/trace/prices.js';
import { DEFAULT_TRACE_CONFIG, describeHit, traceAction, type IndexEntry } from '../src/trace/tracer.js';
import { emptyResult, type ListEntry } from '../src/types.js';
import { action, FakeMidgard, memoryDb } from './helpers.js';

const real = JSON.parse(readFileSync(new URL('./fixtures/midgard-secure-trade-actions.json', import.meta.url), 'utf8')) as Record<string, MidgardAction>;

const prices = new StaticPrices(
	new Map([
		['THOR.RUNE', 1.5],
		['BTC.BTC', 90_000],
		['ETH.ETH', 3_000],
		['ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', 1],
		['GAIA.ATOM', 5]
	])
);

const LISTED = '0x1a7034e8ee6b52f0246343cc48e529c0b5907f67'; // an L1 address listed by a source
const FRESH = 'thor1ggtyq7zjm52acvpe75cxksan42efpxhtde2mxc'; // a fresh thor1 account
const BTC_OUT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BTC_OUT2 = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const ETH_OUT = '0xaaaa000000000000000000000000000000000077';
const TRADE_ACCOUNT = 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55';

const listed = (key: string, extra: Partial<IndexEntry> = {}): IndexEntry => ({
	key,
	hop: 0,
	originRisk: 'high',
	originKey: key,
	originSource: 'ethlabels',
	originEntity: 'Test exploit',
	originCategory: 'hack',
	...extra
});
const lookupOf = (...entries: IndexEntry[]) => {
	const m = new Map(entries.map((e) => [e.key, e]));
	return (k: string) => m.get(k);
};

describe('the real actions are read the way the tracer needs them', () => {
	it('SECURE+ and TRADE+ flow from the L1 payer to the thor1 account; SECURE- and TRADE- from the thor1 account to the L1 payee', () => {
		const shape = (a: MidgardAction) => extractFlows(a, prices).map((f) => `${f.fromKey.split(':')[0]}>${f.toKey.split(':')[0]}:${f.action}`);
		expect(shape(real.secure_plus_eth_token)).toEqual(['evm>thor:secure']);
		expect(shape(real.secure_plus_atom)).toEqual(['gaia>thor:secure']);
		expect(shape(real.secure_minus_btc)).toEqual(['thor>btc:secure']);
		expect(shape(real.secure_minus_usdt)).toEqual(['thor>evm:secure']);
		expect(shape(real.trade_plus_usdt)).toEqual(['evm>thor:trade']);
		expect(shape(real.trade_minus_btc)).toEqual(['thor>btc:trade']);
		expect(shape(real.trade_minus_atom)).toEqual(['thor>gaia:trade']);
		// priced through the secured (`-`) and trade (`~`) asset forms
		expect(extractFlows(real.secure_minus_btc, prices)[0].usd).toBeCloseTo(0.01677477 * 90_000, 0);
		expect(extractFlows(real.trade_plus_usdt, prices)[0].usd).toBeCloseTo(107_563.265, 2);
	});

	it('a real TRADE+ from a listed L1 address flags the trade-account owner, with a reason that says so', () => {
		const a = real.trade_plus_usdt;
		const from = a.in[0].address;
		const hits = traceAction(a, lookupOf(listed(`evm:${from}`)), prices);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ toKey: `thor:${a.out[0].address}`, hop: 1, risk: 'high', action: 'trade' });
		const text = describeHit(hits[0]);
		expect(text.startsWith('Received 107563.265 ETH~USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7 (~$107,563) from 0x8e5686ffbab85fe7d181967b1e2ab4ef3491d8b8, listed by Test exploit (ethlabels) via THORChain trade-account deposit (TRADE+) 19EE2B256BF2E576')).toBe(true);
	});
});

describe('secured-asset and trade-account moves through the tracer (embedded Postgres)', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const entry = (address: string, extra: Partial<ListEntry> = {}): ListEntry => ({
		source: 'ethlabels',
		key: `evm:${address}`,
		chain: 'ETH',
		address,
		category: 'hack',
		risk: 'high',
		code: 'HACK_LABEL',
		entity: 'Test exploit',
		text: 'test listing',
		...extra
	});
	const list = async (...entries: ListEntry[]) => {
		const res = emptyResult();
		res.entries.push(...entries);
		await applySourceResult(sql, { id: 'ethlabels', name: 'eth-labels', kind: 'community' }, res);
	};
	const traced = async (key: string) => (await sql.query<{ hop: number; risk: string }>(`SELECT hop, risk FROM oz_traced WHERE key = $1`, [key])).rows[0];
	const reasonOf = async (key: string) => (await sql.query<{ action: string; reason: string }>(`SELECT action, reason FROM oz_trace_edges WHERE to_key = $1 ORDER BY height LIMIT 1`, [key])).rows[0];

	it('a listed ETH address → SECURE+ → a fresh thor1 is flagged; that thor1 → SECURE- → a BTC address is flagged one hop and risk level on', async () => {
		await list(entry(LISTED));
		const secureIn = action({ type: 'secure', height: 1_000, in: [{ address: LISTED, asset: 'ETH.ETH', amount: 10 }], out: [{ address: FRESH, asset: 'ETH-ETH', amount: 10 }] });
		const secureOut = action({ type: 'secure', height: 1_010, in: [{ address: FRESH, asset: 'ETH-ETH', amount: 9.9 }], out: [{ address: BTC_OUT, asset: 'BTC.BTC', amount: 0.3 }] });
		const r = await runTraceBackfill(sql, new FakeMidgard([secureIn, secureOut]), { prices });
		expect(r.errors).toBe(0);
		expect(await traced(`thor:${FRESH}`)).toMatchObject({ hop: 1, risk: 'high' });
		expect(await traced(`btc:${BTC_OUT}`)).toMatchObject({ hop: 2, risk: 'medium' });
		expect((await reasonOf(`thor:${FRESH}`)).reason).toMatch(/^Received 10 ETH-ETH \(~\$30,000\) from 0x1a70.*, listed by Test exploit \(ethlabels\) via THORChain secured-asset deposit \(SECURE\+\) TX\d+ on 20/);
		expect((await reasonOf(`btc:${BTC_OUT}`)).reason).toMatch(/\(1 hop from Test exploit \(ethlabels\)\) via THORChain secured-asset withdrawal \(SECURE-\)/);
		// published under their own reason codes
		const snap = await collectSnapshot(sql);
		expect(snap.records.find((x) => x.key === `thor:${FRESH}`)?.reasons.map((x) => x.code)).toEqual(['TRACE_SECURE']);
	});

	it('the same through trade accounts: TRADE+ from a listed address, TRADE- out of it', async () => {
		const LISTED_TRADER = '0x5e7034e8ee6b52f0246343cc48e529c0b5907f71';
		await list(entry(LISTED_TRADER));
		const tradeIn = action({ type: 'trade', height: 2_000, in: [{ address: LISTED_TRADER, asset: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', amount: 50_000 }], out: [{ address: TRADE_ACCOUNT, asset: 'ETH~USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', amount: 50_000 }] });
		const tradeOut = action({ type: 'trade', height: 2_010, in: [{ address: TRADE_ACCOUNT, asset: 'BTC~BTC', amount: 0.5 }], out: [{ address: BTC_OUT2, asset: 'BTC.BTC', amount: 0.4995 }] });
		const r = await runTraceBackfill(sql, new FakeMidgard([tradeIn, tradeOut]), { prices });
		expect(r.errors).toBe(0);
		expect(await traced(`thor:${TRADE_ACCOUNT}`)).toMatchObject({ hop: 1, risk: 'high' });
		expect(await traced(`btc:${BTC_OUT2}`)).toMatchObject({ hop: 2, risk: 'medium' });
		expect((await reasonOf(`thor:${TRADE_ACCOUNT}`)).reason).toMatch(/via THORChain trade-account deposit \(TRADE\+\)/);
		expect((await reasonOf(`btc:${BTC_OUT2}`)).reason).toMatch(/via THORChain trade-account withdrawal \(TRADE-\)/);
	});

	it('multi-hop still works across action types, and stops at the hop limit', async () => {
		// listed ETH → SECURE+ → thor1 A (hop 1) → TRADE+ (A's own trade account is a recipient) … → swap → BTC (hop 2) → swap → ETH (hop 3) → swap → (beyond)
		const A = 'thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l';
		const B = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
		const C = '0xbbbb000000000000000000000000000000000088';
		const D = '0xcccc000000000000000000000000000000000099';
		const L2 = '0x2b7034e8ee6b52f0246343cc48e529c0b5907f68';
		await list(entry(L2));
		const chain = [
			action({ type: 'secure', height: 3_000, in: [{ address: L2, asset: 'ETH.ETH', amount: 20 }], out: [{ address: A, asset: 'ETH-ETH', amount: 20 }] }),
			action({ type: 'swap', height: 3_010, in: [{ address: A, asset: 'ETH-ETH', amount: 19.9 }], out: [{ address: B, asset: 'BTC.BTC', amount: 0.9 }], metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } } }),
			action({ type: 'swap', height: 3_020, in: [{ address: B, asset: 'BTC.BTC', amount: 0.89 }], out: [{ address: C, asset: 'ETH.ETH', amount: 26 }], metadata: { swap: { inPriceUSD: '90000', outPriceUSD: '3000' } } }),
			action({ type: 'swap', height: 3_030, in: [{ address: C, asset: 'ETH.ETH', amount: 25.9 }], out: [{ address: D, asset: 'BTC.BTC', amount: 0.85 }], metadata: { swap: { inPriceUSD: '3000', outPriceUSD: '90000' } } })
		];
		await runTraceBackfill(sql, new FakeMidgard(chain), { prices });
		expect(await traced(`thor:${A}`)).toMatchObject({ hop: 1, risk: 'high' });
		expect(await traced(`btc:${B}`)).toMatchObject({ hop: 2, risk: 'medium' });
		expect(await traced(`evm:${C}`)).toMatchObject({ hop: 3, risk: 'low' });
		expect(await traced(`btc:${D}`)).toBeUndefined(); // hop 4: beyond the limit
	});

	it('the dust rules apply: a small SECURE+ flags nothing alone and adds up with others from the same origin', async () => {
		const origin = '0x3c7034e8ee6b52f0246343cc48e529c0b5907f69';
		const payee = 'thor1c3mxxtjksx8l7c3sjuzjelsdw34qsfj5vnzcp9';
		await list(entry(origin));
		// $30 of ETH (0.01 ETH at $3,000) per deposit: under the $50 dust limit on its own
		const small = (height: number) => action({ type: 'secure', height, in: [{ address: origin, asset: 'ETH.ETH', amount: 0.01 }], out: [{ address: payee, asset: 'ETH-ETH', amount: 0.01 }] });
		const m = new FakeMidgard([small(4_000)]);
		await runTraceBackfill(sql, m, { prices });
		expect(await traced(`thor:${payee}`)).toBeUndefined();
		const dust = await sql.query(`SELECT usd, action FROM oz_trace_dust_flows WHERE to_key = $1`, [`thor:${payee}`]);
		expect(dust.rows.map((d) => [Number((d as { usd: string }).usd), (d as { action: string }).action])).toEqual([[30, 'secure']]);
		// a second deposit brings the total to $60 ≥ $50: traced like one flow of that total
		const two = new FakeMidgard([small(4_000), small(4_001)]);
		await sql.query(`UPDATE oz_trace_checked SET status = 'pending', checked_height = 0 WHERE key = $1`, [`evm:${origin}`]);
		await runTraceBackfill(sql, two, { prices });
		expect(await traced(`thor:${payee}`)).toMatchObject({ hop: 1 });
		const snap = await collectSnapshot(sql);
		expect(snap.records.find((x) => x.key === `thor:${payee}`)?.reasons.map((x) => x.code)).toEqual(['TRACE_SMALL_TRANSFERS']);
		// the same rule out of a flagged thor1 account through SECURE- (TRADE- is the same shape)
		const smallOut = (height: number) => action({ type: 'secure', height, in: [{ address: FRESH, asset: 'ETH-ETH', amount: 0.005 }], out: [{ address: ETH_OUT, asset: 'ETH.ETH', amount: 0.005 }] });
		const r = await runTraceBackfill(sql, new FakeMidgard([smallOut(4_100)]), { prices, filter: (k) => k === `thor:${FRESH}` });
		expect(r.errors).toBe(0);
		expect(await traced(`evm:${ETH_OUT}`)).toBeUndefined(); // $15: dust
	});

	it('the real-time follower reads them too', async () => {
		const origin = '0x4d7034e8ee6b52f0246343cc48e529c0b5907f70';
		const payee = 'thor1lj3q7dfg4zwrmtkmqg4u44vy4l44uc68gx892g';
		await list(entry(origin));
		const head = action({ height: 5_000, in: [{ address: 'thor1abc', asset: 'THOR.RUNE', amount: 1 }] });
		await runRealtimeTick(sql, new FakeMidgard([head]), { prices }); // the first tick only records the head
		await sql.query(`DELETE FROM oz_state WHERE id = 'trace:realtime'`);
		await sql.query(`INSERT INTO oz_state (id, value) VALUES ('trace:realtime', '{"height": 5000}')`);
		const dep = action({ type: 'secure', height: 5_001, in: [{ address: origin, asset: 'ETH.ETH', amount: 5 }], out: [{ address: payee, asset: 'ETH-ETH', amount: 5 }] });
		const tick = await runRealtimeTick(sql, new FakeMidgard([head, dep]), { prices, index: await loadTraceIndex(sql) });
		expect(tick).toMatchObject({ processed: 1, hits: 1, traced: 1 });
		expect(await traced(`thor:${payee}`)).toMatchObject({ hop: 1, risk: 'high' });
		expect(DEFAULT_TRACE_CONFIG.dustUsd).toBe(50);
	});
});
