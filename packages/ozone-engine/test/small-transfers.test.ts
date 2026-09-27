/**
 * Small transfers (each under the $50 dust limit) from a flagged address:
 * counted once per THORChain transaction however often the action is read,
 * and added up per (origin, recipient, hop).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { evaluate } from '../../ozone-client/src/index.js';
import { collectSnapshot } from '../src/snapshot/builder.js';
import { applySourceResult } from '../src/store/entries.js';
import { dustTotals, loadTraceIndex, recordDustFlows, recordHits, setState } from '../src/store/trace.js';
import { checkAddress, runRealtimeTick, runTraceBackfill } from '../src/trace/jobs.js';
import { DEFAULT_TRACE_CONFIG, traceAction, traceRisk, type DustFlow, type IndexEntry, type TraceHit } from '../src/trace/tracer.js';
import { emptyResult, type Logger, type Sql } from '../src/types.js';
import { action, FakeMidgard, memoryDb } from './helpers.js';

/**
 * Lists ETH addresses as hack origins at risk `high` (one source sync: a
 * later sync of the same source replaces its entries).
 */
async function listOrigins(sql: Sql, origins: Array<{ address: string; entity: string }>) {
	const res = emptyResult();
	for (const { address, entity } of origins) {
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
	}
	await applySourceResult(sql, { id: 'ethlabels', name: 'eth-labels', kind: 'community' }, res);
}
const listOrigin = (sql: Sql, address: string) => listOrigins(sql, [{ address, entity: 'Small-transfer test origin' }]);

/** A swap from `from` (ETH) to `to` (BTC) worth `usd` at the swap's own price. */
const swap = (height: number, from: string, to: string, usd: number, txID?: string) =>
	action({
		height,
		in: [{ address: from, asset: 'ETH.ETH', amount: 1, ...(txID ? { txID } : {}) }],
		out: [{ address: to, asset: 'BTC.BTC', amount: 1 }],
		metadata: { swap: { outPriceUSD: String(usd) } }
	});

/** A swap from a BTC address `from` to an ETH address `to` worth `usd`. */
const swapFromBtc = (height: number, from: string, to: string, usd: number, txID?: string) =>
	action({
		height,
		in: [{ address: from, asset: 'BTC.BTC', amount: 1, ...(txID ? { txID } : {}) }],
		out: [{ address: to, asset: 'ETH.ETH', amount: 1 }],
		metadata: { swap: { outPriceUSD: String(usd) } }
	});

/** Collects what the engine logs. */
function captureLogger(): Logger & { lines: string[] } {
	const lines: string[] = [];
	return { lines, info: (m) => lines.push(`info ${m}`), warn: (m) => lines.push(`warn ${m}`), error: (m) => lines.push(`error ${m}`) };
}

const tracedRow = async (sql: Sql, key: string) =>
	(
		await sql.query<{ hop: number; risk: string; first_height: string | number; first_txid: string; usd: string | number; edges: number }>(
			`SELECT hop, risk, first_height, first_txid, usd, edges FROM oz_traced WHERE key = $1`,
			[key]
		)
	).rows[0];

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

		// read six times, a counter would stand at $180: the recipient of one
		// $30 transfer must be neither traced nor published
		expect(await tracedRow(sql, recipientKey)).toBeUndefined();
		const snap = await collectSnapshot(sql);
		expect(snap.records.find((x) => x.key === recipientKey)).toBeUndefined();
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

describe('a recipient built only from small transfers is traced, published and followed onward', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const origin = '0x' + 'e3'.repeat(20);
	const originKey = `evm:${origin}`;
	const r = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'; // three $30 transfers from the origin
	const r2 = '0x' + 'a2'.repeat(20); // $6,000 from r after r's total crossed $50
	const r3 = '0x' + 'a3'.repeat(20); // $6,000 from r before r's total crossed $50
	const r4 = '0x' + 'a4'.repeat(20); // two $30 transfers from r (hop 2)
	const below = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'; // $30 + $19 = $49
	const actions = [
		swap(1000, origin, r, 30, 'DUSTR1'),
		swapFromBtc(1001, r, r3, 6000, 'RSENDEARLY'), // r holds $30 of taint here: under the limit
		swap(1002, origin, r, 30, 'DUSTR2'), // the running total reaches $60 here
		swap(1003, origin, r, 30, 'DUSTR3'),
		swapFromBtc(1005, r, r2, 6000, 'RSENDLATE'),
		swapFromBtc(1006, r, r4, 30, 'RDUST1'),
		swapFromBtc(1007, r, r4, 30, 'RDUST2'),
		swap(1010, origin, below, 30, 'BELOW1'),
		swap(1011, origin, below, 19, 'BELOW2')
	];
	let snap: Awaited<ReturnType<typeof collectSnapshot>>;
	const reasonsOf = (address: string) => snap.records.find((x) => x.key.endsWith(`:${address}`))?.reasons;

	it('traces the recipient once its total reaches $50, with the risk one $90 flow would get', async () => {
		await listOrigin(sql, origin);
		const res = await runTraceBackfill(sql, new FakeMidgard(actions));
		expect(res.errors).toBe(0);
		expect(res.dustTraced).toBe(2); // r at hop 1, r4 at hop 2

		const row = await tracedRow(sql, `btc:${r}`);
		// hop 1 from a "high" origin, $90 < $1,000: one level lower, exactly like a single $90 flow
		expect(traceRisk('high', 1, 90, 'value')).toBe('medium');
		expect(row).toMatchObject({ hop: 1, risk: 'medium', first_txid: 'DUSTR2', edges: 0 });
		// tainted from the transfer that brought the total to $50, not before
		expect(Number(row.first_height)).toBe(1002);
		expect(Number(row.usd)).toBe(90);
		// no single flow was large enough for an edge
		const edges = await sql.query(`SELECT 1 FROM oz_trace_edges WHERE to_key = $1`, [`btc:${r}`]);
		expect(edges.rows).toHaveLength(0);
	});

	it('follows it onward at the next hop, only from the crossing on', async () => {
		expect(await tracedRow(sql, `evm:${r2}`)).toMatchObject({ hop: 2, risk: 'medium' });
		expect(await tracedRow(sql, `evm:${r3}`)).toBeUndefined();
		// a traced key's own small transfers add up too, one hop further (hop 2, $60: low)
		expect(await tracedRow(sql, `evm:${r4}`)).toMatchObject({ hop: 2, risk: 'low', first_txid: 'RDUST2' });
		// and they are queued like any traced key below the hop limit
		const checked = await sql.query<{ key: string }>(`SELECT key FROM oz_trace_checked WHERE key = ANY($1::text[])`, [[`btc:${r}`, `evm:${r4}`]]);
		expect(checked.rows.map((x) => x.key).sort()).toEqual([`btc:${r}`, `evm:${r4}`].sort());
	});

	it('publishes a TRACE_SMALL_TRANSFERS reason that says so', async () => {
		snap = await collectSnapshot(sql);
		const [reason, ...rest] = reasonsOf(r) ?? [];
		expect(rest).toEqual([]);
		expect(reason).toMatchObject({
			code: 'TRACE_SMALL_TRANSFERS',
			source: 'thorchain_trace',
			category: 'traced',
			risk: 'medium',
			refId: 'DUSTR2',
			trace: { hop: 1, action: 'small_transfers', txid: 'DUSTR2', height: 1002, usd: 90, amount: '3 transfers', from: origin, originKey }
		});
		expect(reason.text).toBe(
			`Received ~$90 in 3 small THORChain transfers (each under $50) from ${origin}, listed by Small-transfer test origin (ethlabels), on 2025-02-19; the total reached $50 with THORChain swap DUSTR2`
		);
		expect(reasonsOf(r2)?.map((x) => [x.code, x.risk, x.trace?.hop])).toEqual([['TRACE_SWAP', 'medium', 2]]);
		expect(reasonsOf(r4)?.map((x) => [x.code, x.risk, x.trace?.hop])).toEqual([['TRACE_SMALL_TRANSFERS', 'low', 2]]);
		expect(reasonsOf(r4)?.[0].text).toMatch(/^Received ~\$60 in 2 small THORChain transfers \(each under \$50\) from bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 \(1 hop from Small-transfer test origin \(ethlabels\)\)/);
	});

	it('a total below $50 flags nothing', async () => {
		expect(await totalFor(sql, originKey, `btc:${below}`)).toMatchObject({ usd: 49, count: 2 });
		expect(await tracedRow(sql, `btc:${below}`)).toBeUndefined();
		expect(reasonsOf(below)).toBeUndefined();
	});
});

describe('small-transfer totals follow the same demotion rules and outrank weaker reasons', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const origin = '0x' + 'e4'.repeat(20);
	const other = '0x' + 'e5'.repeat(20);
	const recipient = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

	it('21 transfers of $49 ($1,029) publish "high" at hop 1 — flagged by the default policy — ahead of three medium edges', async () => {
		await listOrigins(sql, [
			{ address: origin, entity: 'Small-transfer test origin' },
			{ address: other, entity: 'Another test origin' }
		]);
		const actions = [
			...Array.from({ length: 21 }, (_, i) => swap(2000 + i, origin, recipient, 49)),
			...[60, 70, 80].map((usd, i) => swap(2100 + i, other, recipient, usd))
		];
		expect((await runTraceBackfill(sql, new FakeMidgard(actions))).errors).toBe(0);
		expect(traceRisk('high', 1, 21 * 49, 'value')).toBe('high');

		const snap = await collectSnapshot(sql);
		const reasons = snap.records.find((x) => x.key === `btc:${recipient}`)?.reasons ?? [];
		expect(reasons).toHaveLength(3); // the strongest three of four
		expect(reasons[0]).toMatchObject({ code: 'TRACE_SMALL_TRANSFERS', risk: 'high', trace: { usd: 1029 } });
		expect(reasons.slice(1).map((x) => x.risk)).toEqual(['medium', 'medium']);
		expect(evaluate(reasons).status).toBe('flagged');
	});
});

describe('third-party small transfers never create a link', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const origin = '0x' + 'e6'.repeat(20);
	const thirdParty = '0x' + 'f6'.repeat(20);
	const recipient = '19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE';

	it("only the listed sender's own transfers count: $30 from it plus $100 from someone else stays under $50", async () => {
		await listOrigin(sql, origin);
		const actions = [
			// an unlisted third party sends the recipient five $20 transfers...
			...Array.from({ length: 5 }, (_, i) => swap(3000 + i, thirdParty, recipient, 20)),
			// ...the listed address sends it one $30 transfer...
			swap(3010, origin, recipient, 30),
			// ...and the third party dusts the listed address itself
			...Array.from({ length: 3 }, (_, i) =>
				action({
					height: 3020 + i,
					in: [{ address: thirdParty, asset: 'ETH.ETH', amount: 1 }],
					out: [{ address: origin, asset: 'ETH.ETH', amount: 1 }],
					metadata: { swap: { outPriceUSD: '20' } }
				})
			)
		];
		const midgard = new FakeMidgard(actions);
		expect((await runTraceBackfill(sql, midgard)).errors).toBe(0);
		// the real-time follower sees every action, the third party's included
		await setState(sql, 'trace:realtime', { height: 2999 });
		await runRealtimeTick(sql, midgard);

		const ledger = await sql.query<{ from_key: string; to_key: string; usd: string }>(`SELECT from_key, to_key, usd FROM oz_trace_dust_flows`);
		expect(ledger.rows.map((x) => [x.from_key, x.to_key, Number(x.usd)])).toEqual([[`evm:${origin}`, `btc:${recipient}`, 30]]);
		const traced = await sql.query<{ key: string }>(`SELECT key FROM oz_traced`);
		expect(traced.rows).toEqual([]);
		const snap = await collectSnapshot(sql);
		expect(snap.records.some((x) => x.key === `btc:${recipient}` || x.key === `evm:${thirdParty}`)).toBe(false);
	});
});

describe('fan-out cap on the small-transfer path', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const origin = '0x' + 'e7'.repeat(20);
	const originKey = `evm:${origin}`;
	const cfg = { ...DEFAULT_TRACE_CONFIG, maxDustRecipients: 2 };
	// four recipients, all past $50: $90, $80, $70, $60
	const recipients = ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', '19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE'];
	const pieces = [
		[30, 30, 30],
		[40, 40],
		[35, 35],
		[30, 30]
	];
	const actions = recipients.flatMap((to, i) => pieces[i].map((usd, j) => swap(4000 + i * 10 + j, origin, to, usd)));

	it('follows at most maxDustRecipients per origin and hop onward (most value first), logs the rest, publishes all', async () => {
		await listOrigin(sql, origin);
		const log = captureLogger();
		const midgard = new FakeMidgard(actions);
		const res = await runTraceBackfill(sql, midgard, { cfg, logger: log });
		expect(res).toMatchObject({ errors: 0, dustTraced: 2, dustSkipped: 2 });

		// the two largest totals are traced and their histories read (followed onward)...
		const traced = await sql.query<{ key: string }>(`SELECT key FROM oz_traced ORDER BY key`);
		expect(traced.rows.map((x) => x.key)).toEqual([`btc:${recipients[0]}`, `btc:${recipients[1]}`].sort());
		expect(midgard.requests).toEqual(expect.arrayContaining([recipients[0], recipients[1]]));
		// ...the other two are not queued for onward tracing
		expect(midgard.requests).not.toContain(recipients[2]);
		expect(midgard.requests).not.toContain(recipients[3]);
		const index = await loadTraceIndex(sql);
		expect(index.has(`btc:${recipients[2]}`)).toBe(false);

		const warning = log.lines.find((l) => l.startsWith('warn') && l.includes('fan-out cap'));
		expect(warning).toContain(originKey);
		expect(warning).toContain('2 more published but not traced further');
		expect(warning).toContain(`btc:${recipients[2]}`);
		expect(warning).toContain(`btc:${recipients[3]}`);

		// every recipient that crossed $50 is still published with its reason
		const snap = await collectSnapshot(sql);
		for (const [i, to] of recipients.entries()) {
			const reasons = snap.records.find((x) => x.key === `btc:${to}`)?.reasons;
			expect(reasons?.map((x) => [x.code, x.risk]), to).toEqual([['TRACE_SMALL_TRANSFERS', 'medium']]);
			expect(reasons?.[0].trace?.usd).toBe(pieces[i].reduce((a, b) => a + b, 0));
		}
	});

	it('stays capped (and counted once) when the same history is read again', async () => {
		await rereadEverything(sql);
		const res = await runTraceBackfill(sql, new FakeMidgard(actions), { cfg, logger: captureLogger() });
		expect(res).toMatchObject({ errors: 0, dustTraced: 0 });
		const traced = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM oz_traced`);
		expect(traced.rows[0].n).toBe(2);
		expect((await dustTotals(sql)).map((d) => d.usd).sort((a, b) => b - a)).toEqual([90, 80, 70, 60]);
	});
});

describe('small transfers are only recorded where a total could flag', () => {
	const flows: DustFlow[] = [];
	const sender = (hop: number, originRisk: IndexEntry['originRisk']): IndexEntry => ({
		key: 'btc:1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
		hop,
		originRisk,
		originKey: 'evm:0xseed',
		originSource: 'test',
		originCategory: 'hack'
	});
	const dust = action({
		height: 5000,
		in: [{ address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', asset: 'BTC.BTC', amount: 1 }],
		out: [{ address: '0x' + 'a9'.repeat(20), asset: 'ETH.ETH', amount: 1 }],
		metadata: { swap: { outPriceUSD: '20' } }
	});
	const record = (e: IndexEntry) => {
		flows.length = 0;
		traceAction(dust, (k) => (k === e.key ? e : undefined), undefined, DEFAULT_TRACE_CONFIG, (d) => flows.push(d));
		return flows.length;
	};

	it('inside the hop limit, from an origin whose flows could still flag at that hop', () => {
		expect(record(sender(2, 'high'))).toBe(1); // hop 3
		expect(record(sender(3, 'severe'))).toBe(0); // hop 4: past the hop limit
		expect(record(sender(1, 'medium'))).toBe(1); // hop 2 from a phishing-level origin: a large total is "low"
		expect(record(sender(2, 'medium'))).toBe(0); // hop 3 from it: nothing could ever flag
	});
});
