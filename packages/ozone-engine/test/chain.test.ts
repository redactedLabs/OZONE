/**
 * Value flows through CosmWasm contracts, read from the chain's transaction
 * events (trace/chain.ts): the extraction rules on real Rujira transactions
 * (test/fixtures/chain-*.json, THORNode 3.20.3) and on transactions built
 * from their shape, the THORNode client, the real-time chain follower and the
 * per-account history against an embedded Postgres, and THORChain accounts
 * found paying a listed address.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { generateSigningKey, loadPrivateKey, decodePayload, verifyManifest, type SnapshotIndex } from '../../ozone-client/src/index.js';
import { publishSnapshot } from '../src/jobs.js';
import { coverageReport } from '../src/report.js';
import { screenUsers } from '../src/screen/users.js';
import { applySourceResult } from '../src/store/entries.js';
import { getState, loadTraceIndex, maybeResetBackfill, pendingChainChecks, planTraceBackfill, recordHits, recordPayerLinks, setState } from '../src/store/trace.js';
import { Chain, denomAsset, extractChainFlows, memoDestination, parseCoins, TX_PAGE_SIZE, type ChainTx } from '../src/trace/chain.js';
import { CONTRACT_ACTION } from '../src/trace/flows.js';
import { checkChainHistory, runChainBackfill, runChainTick, runTraceBackfill } from '../src/trace/jobs.js';
import { StaticPrices } from '../src/trace/prices.js';
import { DEFAULT_TRACE_CONFIG, describeHit, traceAction, traceFlows, type IndexEntry, type PayerLink } from '../src/trace/tracer.js';
import { emptyResult, type ListEntry } from '../src/types.js';
import { action, chainTx, FakeChain, FakeMidgard, memoryDb } from './helpers.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as ChainTx;

const prices = new StaticPrices(
	new Map([
		['THOR.RUNE', 1.5],
		['BTC.BTC', 90_000],
		['ETH.ETH', 6_000],
		['ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7', 1],
		['ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599', 90_000]
	])
);

// real, valid addresses: accounts (20 bytes) and contracts (32 bytes)
const X = 'thor1z4ypwv8hp829qka2nyur68k3d4jfgp3fp2eqkk'; // the signer / flagged account
const Y = 'thor1ggtyq7zjm52acvpe75cxksan42efpxhtde2mxc'; // a fresh account
const Z = 'thor1afvpgqf3k52z96haa0xw30jsfzjpeamyqjcupw'; // a second fresh account
const V = 'thor1uu48rykx2dpatdhk335fc6ms7xyxmq7ph0hlgr';
const FIN = 'thor1g3mymxjlmvyeadfys6lsj98sgg7mxut5pwz99q5rat7ny698elwq778ngf'; // a FIN market
const FEES = 'thor1gm8q2gr25nzzsxzdp2mpja4hyvyhjlr4s6krcsgv2y953uu0js3qhwpus7'; // Rujira's fee collector (a contract)
const BTC_DEST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const rune = (n: number) => `${Math.round(n * 1e8)}rune`;

describe('parsers', () => {
	it('reads coin lists, denoms and swap memos', () => {
		expect(parseCoins('1420btc-btc,781eth-wbtc-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599')).toEqual([
			{ amount: 1420n, denom: 'btc-btc' },
			{ amount: 781n, denom: 'eth-wbtc-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' }
		]);
		expect(parseCoins('9000109130x/ruji')).toEqual([{ amount: 9000109130n, denom: 'x/ruji' }]);
		expect(parseCoins('')).toEqual([]);
		expect(parseCoins('nonsense')).toEqual([]);
		expect(denomAsset('rune')).toBe('THOR.RUNE');
		expect(denomAsset('btc-btc')).toBe('BTC.BTC');
		expect(denomAsset('eth-usdt-0xdac17f958d2ee523a2206206994597c13d831ec7')).toBe('ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7');
		expect(denomAsset('x/ruji')).toBe('THOR.RUJI');
		expect(denomAsset('factory/thor1abc/lp')).toBe('factory/thor1abc/lp'); // unknown: no price
		expect(memoDestination(`=:BTC.BTC:${BTC_DEST}:0/3/0`)?.key).toBe(`btc:${BTC_DEST}`);
		expect(memoDestination(`=:ETH-WBTC:${FIN}/${FIN}`)?.key).toBe(`thor:${FIN}`);
		expect(memoDestination('+:BTC.BTC')).toBeUndefined();
		expect(memoDestination(undefined)).toBeUndefined();
	});
});

describe('flows from transaction events (real Rujira transactions)', () => {
	it('a FIN swap, a Liquidy swap and a contract-started THORChain swap whose output returns to the signer move nothing to anyone else', () => {
		for (const name of ['chain-fin-swap', 'chain-liquidy-swap', 'chain-thorchain-swap']) {
			expect(extractChainFlows(fixture(name), prices), name).toEqual([]);
		}
	});

	it('the same FIN swap with its output sent to another account is a flow from the taker to that account', () => {
		const tx = fixture('chain-fin-swap');
		const taker = 'thor1v5ykttyd0fy6ga68djecegekm4drzjcgywe3hv';
		// message 1 (ETH → RUNE): the contract pays the RUNE output to Y instead of the taker (`swap { to: Y }`)
		const redirected: ChainTx = {
			...tx,
			events: tx.events.map((e) =>
				e.type === 'transfer' &&
				e.attributes.some((a) => a.key === 'msg_index' && a.value === '1') &&
				e.attributes.some((a) => a.key === 'recipient' && a.value === taker)
					? { ...e, attributes: e.attributes.map((a) => (a.key === 'recipient' ? { ...a, value: Y } : a)) }
					: e
			)
		};
		const flows = extractChainFlows(redirected, prices);
		expect(flows).toHaveLength(1);
		expect(flows[0]).toMatchObject({
			action: CONTRACT_ACTION,
			relation: 'value',
			fromKey: `thor:${taker}`,
			toKey: `thor:${Y}`,
			txid: tx.hash,
			height: tx.height
		});
		expect(flows[0].amount).toBe('34.585 THOR.RUNE');
		// the taker put 952,757 ETH-units ($57) in; the output is worth $51.9: what arrived, never more than what went in
		expect(flows[0].usd).toBeCloseTo((3458495587 / 1e8) * 1.5, 4);
	});
});

describe('flows from transaction events (attribution rules)', () => {
	const call = (msg: Parameters<typeof chainTx>[0]['msgs'][number], height = 100) => extractChainFlows(chainTx({ height, msgs: [msg] }), prices);

	it('a swap with a recipient: the contract pays the output to another account', () => {
		const flows = call({
			signer: X,
			transfers: [
				[X, FIN, rune(10_000)],
				[FIN, FEES, rune(30)],
				[FIN, Y, rune(9_960)]
			],
			wasm: [{ type: 'rujira-fin/trade', attrs: { _contract_address: FIN, price: 'ccl:1', side: 'quote' } }]
		});
		expect(flows).toHaveLength(1); // the fee collector is a contract
		expect(flows[0]).toMatchObject({ fromKey: `thor:${X}`, toKey: `thor:${Y}`, action: CONTRACT_ACTION });
		expect(flows[0].usd).toBeCloseTo(9_960 * 1.5, 2);
	});

	it('the signer receiving its own output is no flow; neither is a payment to a module or a contract', () => {
		expect(call({ signer: X, transfers: [[X, FIN, rune(10_000)], [FIN, X, rune(9_900)], [FIN, FEES, rune(30)]] })).toEqual([]);
		expect(call({ signer: X, transfers: [[X, FIN, rune(10_000)], [FIN, 'thor1dl7un46w7l7f3ewrnrm6nq58nerjtp0dradjtd', rune(100)]] })).toEqual([]);
	});

	it('a poke — the signer put nothing in and acts on no position of its own — pays third parties nothing of its own', () => {
		// e.g. a keeper calling a distribution that pays stakers
		expect(call({ signer: X, transfers: [[FIN, Y, rune(5_000)], [FIN, Z, rune(5_000)]], wasm: [{ type: 'rujira-staking/distribute', attrs: { _contract_address: FIN } }] })).toEqual([]);
	});

	it('the signer withdrawing its own position pays the recipient it names', () => {
		const flows = call({
			signer: X,
			transfers: [[FIN, Y, rune(4_000)]],
			wasm: [{ type: 'rujira-fin/order.withdraw', attrs: { _contract_address: FIN, owner: X, price: 'fixed:1', side: 'quote', amount: '400000000000' } }]
		});
		expect(flows).toHaveLength(1);
		expect(flows[0]).toMatchObject({ toKey: `thor:${Y}` });
		expect(flows[0].usd).toBeCloseTo(6_000, 2);
		// another account's position being withdrawn in a call that is not the signer's own is a poke
		expect(call({ signer: X, transfers: [[FIN, Y, rune(4_000)]], wasm: [{ type: 'rujira-fin/order.withdraw', attrs: { _contract_address: FIN, owner: Y } }] })).toEqual([]);
	});

	it('a position funded for another owner is a flow to that owner; one the signer owns is not', () => {
		const funded = call({ signer: X, transfers: [[X, FIN, rune(2_000)]], wasm: [{ type: 'rujira-fin/order.create', attrs: { _contract_address: FIN, owner: Y, offer: '200000000000', price: 'fixed:1', side: 'quote' } }] });
		expect(funded).toHaveLength(1);
		expect(funded[0]).toMatchObject({ fromKey: `thor:${X}`, toKey: `thor:${Y}` });
		expect(funded[0].usd).toBeCloseTo(3_000, 2);
		expect(call({ signer: X, transfers: [[X, FIN, rune(2_000)]], wasm: [{ type: 'rujira-fin/order.create', attrs: { _contract_address: FIN, owner: X, offer: '200000000000' } }] })).toEqual([]);
	});

	it('a side payment under 5 % of the largest one (an affiliate or platform fee) is not a flow', () => {
		const flows = call({ signer: X, transfers: [[X, FIN, rune(10_000)], [FIN, Y, rune(9_850)], [FIN, Z, rune(100)]] });
		expect(flows.map((f) => f.toKey)).toEqual([`thor:${Y}`]);
		// an even split is two flows
		const split = call({ signer: X, transfers: [[X, FIN, rune(10_000)], [FIN, Y, rune(5_000)], [FIN, Z, rune(4_900)]] });
		expect(split.map((f) => f.toKey).sort()).toEqual([`thor:${Y}`, `thor:${Z}`].sort());
	});

	it('valued by what the recipient got, capped by what the signer put in; an unpriced output takes the input value; nothing is flagged on unknown values', () => {
		// the recipient gets far more than the signer put in (its own funds): capped at the input
		expect(call({ signer: X, transfers: [[X, FIN, rune(100)], [FIN, Y, rune(10_000)]] })[0].usd).toBeCloseTo(150, 2);
		// Rujira's own token out, RUNE in: valued by the input
		const unpricedOut = call({ signer: X, transfers: [[X, FIN, rune(1_000)], [FIN, Y, '500000000000x/ruji']] });
		expect(unpricedOut).toHaveLength(1);
		expect(unpricedOut[0].usd).toBeCloseTo(1_500, 2);
		// RUNE out, RUJI in: valued by the output
		expect(call({ signer: X, transfers: [[X, FIN, '500000000000x/ruji'], [FIN, Y, rune(1_000)]] })[0].usd).toBeCloseTo(1_500, 2);
		// unknown on both sides (a worthless token cannot be a way to flag an account)
		expect(call({ signer: X, transfers: [[X, FIN, '500000000000x/ruji'], [FIN, Y, '5000factory/thor1abc/junk']] })).toEqual([]);
	});

	it('a swap a contract starts toward an L1 address or another account is a flow to it (the swap memo); one back to itself is not', () => {
		const swap = (memo: string) =>
			call({
				signer: X,
				transfers: [[X, FIN, rune(3_000)]],
				wasm: [{ type: 'rujira-thorchain-swap/swap', attrs: { _contract_address: FIN, memo, amount: rune(3_000), returned: '0btc-btc' } }] // the output of a swap toward an L1 address is not known yet
			});
		const toBtc = swap(`=:BTC.BTC:${BTC_DEST}:0/3/0`);
		expect(toBtc).toHaveLength(1);
		expect(toBtc[0]).toMatchObject({ fromKey: `thor:${X}`, toKey: `btc:${BTC_DEST}`, toChain: 'BTC' });
		expect(toBtc[0].usd).toBeCloseTo(4_500, 2);
		expect(swap(`=:ETH-WBTC:${Y}`)[0]).toMatchObject({ toKey: `thor:${Y}` });
		expect(swap(`=:ETH-WBTC:${FIN}/${FIN}`)).toEqual([]); // back to a contract
		expect(swap(`=:BTC.BTC:${X}`)).toEqual([]); // back to the signer
	});

	it('failed transactions, contract signers and other message types move nothing', () => {
		const t = chainTx({ height: 100, msgs: [{ signer: X, transfers: [[X, FIN, rune(1_000)], [FIN, Y, rune(990)]] }] });
		expect(extractChainFlows(t, prices)).toHaveLength(1);
		expect(extractChainFlows({ ...t, code: 5 }, prices)).toEqual([]);
		expect(extractChainFlows(chainTx({ height: 100, msgs: [{ signer: FIN, transfers: [[FIN, FEES, rune(1_000)], [FEES, Y, rune(990)]] }] }), prices)).toEqual([]);
		const bank: ChainTx = { ...t, events: t.events.map((e) => (e.type === 'message' ? { ...e, attributes: e.attributes.map((a) => (a.key === 'action' ? { ...a, value: '/cosmos.bank.v1beta1.MsgSend' } : a)) } : e)) };
		expect(extractChainFlows(bank, prices)).toEqual([]); // plain sends are Midgard's
		expect(extractChainFlows(t)).toEqual([]); // without prices nothing is read
	});

	it('every message of a transaction counts for its own signer', () => {
		const flows = extractChainFlows(
			chainTx({
				height: 100,
				msgs: [
					{ signer: X, transfers: [[X, FIN, rune(1_000)], [FIN, Y, rune(990)]] },
					{ signer: Z, transfers: [[Z, FIN, rune(2_000)], [FIN, V, rune(1_980)]] }
				]
			}),
			prices
		);
		expect(flows.map((f) => `${f.fromAddress}>${f.toAddress}`).sort()).toEqual([`${X}>${Y}`, `${Z}>${V}`].sort());
	});
});

describe('the THORNode client', () => {
	it('pages oldest first with the events query and resumes where a bounded read stopped', async () => {
		const txs = Array.from({ length: 120 }, (_, i) => chainTx({ height: 1_000 + i, hash: `H${i}`, msgs: [{ signer: X, transfers: [[X, FIN, rune(1)]] }] }));
		const urls: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			urls.push(url.pathname + url.search);
			if (url.pathname === '/thorchain/lastblock') return new Response(JSON.stringify([{ chain: 'BTC', thorchain: 1_119 }]), { status: 200 });
			const page = Number(url.searchParams.get('page'));
			const rows = txs.slice((page - 1) * TX_PAGE_SIZE, page * TX_PAGE_SIZE).map((t) => ({ txhash: t.hash.toLowerCase(), height: String(t.height), timestamp: t.date, code: 0, events: t.events }));
			return new Response(JSON.stringify({ tx_responses: rows, total: String(txs.length) }), { status: 200 });
		}) as typeof fetch;
		const chain = new Chain({ baseUrl: 'https://thornode.test/', minIntervalMs: 0, http: { fetch: fetchImpl, retries: 0 } });
		expect(await chain.latestHeight()).toBe(1_119);

		const all: ChainTx[] = [];
		const progress = { complete: false } as { complete: boolean; resumeHeight?: number };
		for await (const t of chain.wasmTxs({ signer: X, fromHeight: 1_000, toHeight: 2_000, progress })) all.push(t);
		expect(all.map((t) => t.hash)).toEqual(txs.map((t) => t.hash)); // upper-cased hashes, ascending
		expect(progress.complete).toBe(true);
		const q = new URL(`https://x.test${urls[1]}`).searchParams;
		expect(q.get('query')).toBe(`message.action='/cosmwasm.wasm.v1.MsgExecuteContract' AND tx.height>=1000 AND tx.height<=2000 AND message.sender='${X}'`);
		expect(q.get('order_by')).toBe('ORDER_BY_ASC');

		const cut = { complete: true } as { complete: boolean; resumeHeight?: number };
		const first: ChainTx[] = [];
		for await (const t of chain.wasmTxs({ fromHeight: 1_000, maxPages: 1, progress: cut })) first.push(t);
		expect(first).toHaveLength(TX_PAGE_SIZE);
		expect(cut).toEqual({ complete: false, resumeHeight: 1_049 });

		// only a thor address can be put into the query
		await expect(chain.wasmTxs({ signer: `${X}' OR tx.height>0 --`, fromHeight: 1 }).next()).rejects.toThrow(/not a thor address/);
	});
});

describe('the chain follower and the history of flagged accounts (embedded Postgres)', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const entry = (key: string, address: string, extra: Partial<ListEntry> = {}): ListEntry => ({
		source: 'curated',
		key,
		chain: 'THOR',
		address,
		category: 'hack',
		risk: 'high',
		code: 'INCIDENT_EXPLOITER',
		entity: 'Test exploit',
		text: 'test listing',
		...extra
	});
	const list = async (...entries: ListEntry[]) => {
		const res = emptyResult();
		res.entries.push(...entries);
		await applySourceResult(sql, { id: 'curated', name: 'curated', kind: 'curated' }, res);
	};
	const swapTo = (height: number, signer: string, to: string, amount: number) =>
		chainTx({ height, hash: `SWAP${height}`, msgs: [{ signer, transfers: [[signer, FIN, rune(amount)], [FIN, FEES, rune(amount * 0.003)], [FIN, to, rune(amount * 0.99)]] }] });
	const tracedRow = async (address: string) =>
		(await sql.query<{ hop: number; risk: string; first_txid: string }>(`SELECT hop, risk, first_txid FROM oz_traced WHERE key = $1`, [`thor:${address}`])).rows[0];

	it('the follower starts at the head, reads nothing without prices, then flags the recipient of a flagged account', async () => {
		await list(entry(`thor:${X}`, X));
		const chain = new FakeChain([swapTo(5_010, X, Y, 10_000)], 5_000);
		expect(await runChainTick(sql, chain, { prices })).toMatchObject({ from: 5_000, to: 5_000, processed: 0 });
		expect(await getState(sql, 'trace:chain')).toEqual({ height: 5_000 });

		chain.head = 5_020;
		// no prices: the cursor must not move (a flow read without a price is dropped for good)
		expect(await runChainTick(sql, chain, {})).toMatchObject({ skipped: 'no prices yet', from: 5_000, to: 5_000 });
		expect(await getState(sql, 'trace:chain')).toEqual({ height: 5_000 });

		const tick = await runChainTick(sql, chain, { prices });
		expect(tick).toMatchObject({ processed: 1, hits: 1, traced: 1, from: 5_000, to: 5_020, complete: true });
		expect(await tracedRow(Y)).toMatchObject({ hop: 1, risk: 'high', first_txid: 'SWAP5010' });
		const edge = await sql.query<{ action: string; reason: string }>(`SELECT action, reason FROM oz_trace_edges WHERE to_key = $1`, [`thor:${Y}`]);
		expect(edge.rows[0].action).toBe(CONTRACT_ACTION);
		expect(edge.rows[0].reason).toMatch(new RegExp(`^Received 9900 THOR\\.RUNE \\(~\\$14,850\\) from ${X}, listed by Test exploit \\(curated\\) via a CosmWasm contract call on THORChain \\(transaction events\\) SWAP5010 on 20`));
		// replaying the window adds nothing
		await setState(sql, 'trace:chain', { height: 5_000 });
		await runChainTick(sql, chain, { prices });
		expect((await sql.query(`SELECT 1 FROM oz_trace_edges WHERE to_key = $1`, [`thor:${Y}`])).rows).toHaveLength(1);
	});

	it('multi-hop through contracts: the recipient, once traced, flags the next one at hop 2; the hop limit holds', async () => {
		const chain = new FakeChain([swapTo(5_030, Y, Z, 8_000), swapTo(5_040, Z, V, 6_000)], 5_050);
		await setState(sql, 'trace:chain', { height: 5_020 });
		// one tick sees Y's swap (Y is traced) — Z is flagged; V only after Z is in the index (the tick reloads it each time)
		const t1 = await runChainTick(sql, chain, { prices });
		expect(t1.processed).toBe(2);
		expect(await tracedRow(Z)).toMatchObject({ hop: 2, risk: 'medium' });
		expect(await tracedRow(V)).toBeUndefined(); // both transactions were in one window: Z was not yet flagged when its own swap was read
		// the history check of Z (a newly flagged account) finds it
		const r = await runChainBackfill(sql, chain, { prices });
		expect(r.errors).toBe(0);
		expect(await tracedRow(V)).toMatchObject({ hop: 3, risk: 'low' });
		// hop 3 is the limit: nothing is flagged beyond it
		const beyond = new FakeChain([swapTo(5_060, V, 'thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l', 5_000)], 5_070);
		await setState(sql, 'trace:chain', { height: 5_050 });
		await runChainTick(sql, beyond, { prices });
		expect(await tracedRow('thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l')).toBeUndefined();
	});

	it('a window with more contract transactions than the tick reads stops below the height it cut and continues', async () => {
		const many = Array.from({ length: 130 }, (_, i) => chainTx({ height: 6_001 + Math.floor(i / 2), hash: `BULK${i}`, msgs: [{ signer: X, transfers: [[X, FIN, rune(1)], [FIN, X, rune(1)]] }] }));
		const chain = new FakeChain(many, 6_070);
		await setState(sql, 'trace:chain', { height: 6_000 });
		const seen = new Set<string>();
		const spy = { ...chain, latestHeight: () => chain.latestHeight(), wasmTxs: async function* (q: Parameters<FakeChain['wasmTxs']>[0]) { for await (const t of chain.wasmTxs(q)) { seen.add(t.hash); yield t; } } };
		let ticks = 0;
		for (let guard = 0; guard < 10; guard++) {
			const r = await runChainTick(sql, spy, { prices, maxPages: 1 });
			ticks++;
			if (r.complete) break;
		}
		expect(ticks).toBeGreaterThan(1);
		expect(seen.size).toBe(130); // no transaction was skipped
		expect((await getState<{ height: number }>(sql, 'trace:chain'))?.height).toBe(6_070);
	});

	it('the history of a flagged account: read once, oldest first, dust kept apart, then nothing left to do', async () => {
		const A = 'thor1c3mxxtjksx8l7c3sjuzjelsdw34qsfj5vnzcp9';
		const B = 'thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l';
		const C = 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55';
		await list(entry(`thor:${A}`, A));
		const chain = new FakeChain([swapTo(7_000, A, B, 10_000), swapTo(7_001, A, C, 20)], 7_100); // $15,000 and $30 (under the $50 dust limit)
		const r = await runChainBackfill(sql, chain, { prices, filter: (k) => k === `thor:${A}` });
		expect(r).toMatchObject({ checked: 1, txs: 2, errors: 0 });
		expect(await tracedRow(B)).toMatchObject({ hop: 1, risk: 'high' });
		expect(await tracedRow(C)).toBeUndefined();
		const dust = await sql.query(`SELECT usd FROM oz_trace_dust_flows WHERE to_key = $1`, [`thor:${C}`]);
		expect(dust.rows).toHaveLength(1);
		const done = await sql.query<{ status: string; txs: number }>(`SELECT status, txs FROM oz_trace_chain_checked WHERE key = $1`, [`thor:${A}`]);
		expect(done.rows[0]).toMatchObject({ status: 'done', txs: 2 });
		expect((await runChainBackfill(sql, chain, { prices, filter: (k) => k === `thor:${A}` })).checked).toBe(0);
	});

	it('a long history continues in the next slice; an account whose read fails is marked and retried later', async () => {
		const L = 'thor1lj3q7dfg4zwrmtkmqg4u44vy4l44uc68gx892g';
		await list(entry(`thor:${L}`, L));
		const txs = Array.from({ length: 120 }, (_, i) => chainTx({ height: 8_000 + i, hash: `LONG${i}`, msgs: [{ signer: L, transfers: [[L, FIN, rune(1)], [FIN, L, rune(1)]] }] }));
		const chain = new FakeChain(txs, 8_200);
		const only = (k: string) => k === `thor:${L}`;
		const s1 = await runChainBackfill(sql, chain, { prices, filter: only, pages: { neverService: 1 } });
		expect(s1.checked).toBe(1);
		const mid = await sql.query<{ status: string; checked_height: string }>(`SELECT status, checked_height FROM oz_trace_chain_checked WHERE key = $1`, [`thor:${L}`]);
		expect(mid.rows[0].status).toBe('pending');
		expect(Number(mid.rows[0].checked_height)).toBe(8_049);
		await runChainBackfill(sql, chain, { prices, filter: only, pages: { neverService: 1 } });
		await runChainBackfill(sql, chain, { prices, filter: only, pages: { neverService: 1 } });
		const end = await sql.query<{ status: string }>(`SELECT status FROM oz_trace_chain_checked WHERE key = $1`, [`thor:${L}`]);
		expect(end.rows[0].status).toBe('done');
		expect(chain.reads.map((x) => x.from)).toEqual([0, 8_049, 8_098]); // each slice resumed at the height the last one cut

		const broken: FakeChain = Object.assign(new FakeChain([]), {
			async *wasmTxs(): AsyncGenerator<ChainTx> {
				throw new Error('gateway timeout');
			}
		});
		const M = 'thor1kr08pw3rtng29tj63jgwx22vp4e447mhrcvxyd';
		await list(entry(`thor:${M}`, M));
		const bad = await runChainBackfill(sql, broken, { prices, filter: (k) => k === `thor:${M}` });
		expect(bad).toMatchObject({ errors: 1, checked: 0 });
		const row = await sql.query<{ status: string; error: string }>(`SELECT status, error FROM oz_trace_chain_checked WHERE key = $1`, [`thor:${M}`]);
		expect(row.rows[0]).toMatchObject({ status: 'error', error: 'gateway timeout' });
		const index = await loadTraceIndex(sql);
		expect((await pendingChainChecks(sql, index, DEFAULT_TRACE_CONFIG.maxHops, 100, (k) => k === `thor:${M}`)).length).toBe(0); // waits before the retry
		expect((await pendingChainChecks(sql, index, DEFAULT_TRACE_CONFIG.maxHops, 100, (k) => k === `thor:${M}`, Date.now() + 3_600_000)).length).toBe(1);
	});
});

describe('bounded chain reads', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const LIST = 'thor1xmaggkcln5m5fnha2780xrdrulmplvfrz6wj3l';
	const LOW = 'thor1lj3q7dfg4zwrmtkmqg4u44vy4l44uc68gx892g';
	const busy = (signer: string, n: number, from: number) =>
		Array.from({ length: n }, (_, i) => chainTx({ height: from + i, hash: `BUSY${signer.slice(-4)}${i}`, msgs: [{ signer, transfers: [[signer, FIN, rune(1)], [FIN, signer, rune(1)]] }] }));

	it('a low-risk traced account with more contract transactions than one check reads is a bot or a service and is not followed; a read past its deadline stops and resumes', async () => {
		const res = emptyResult();
		res.entries.push({ source: 'curated', key: `thor:${LIST}`, chain: 'THOR', address: LIST, category: 'hack', risk: 'high', code: 'INCIDENT_EXPLOITER', entity: 'Test', text: 't' });
		await applySourceResult(sql, { id: 'curated', name: 'curated', kind: 'curated' }, res);
		// LIST → LOW (hop 1, high) → a second-hop account that turns out to be a bot
		const BOT = 'thor1kr08pw3rtng29tj63jgwx22vp4e447mhrcvxyd';
		const hop = (signer: string, to: string, height: number) =>
			chainTx({ height, hash: `HOP${height}`, msgs: [{ signer, transfers: [[signer, FIN, rune(10_000)], [FIN, to, rune(9_900)]] }] });
		const chain = new FakeChain([hop(LIST, LOW, 100), hop(LOW, BOT, 101), ...busy(BOT, 120, 200)], 400);
		const r = await runChainBackfill(sql, chain, { prices, pages: { normal: 1, neverService: 10 } });
		expect(r.errors).toBe(0);
		const row = async (k: string) => (await sql.query<{ status: string }>(`SELECT status FROM oz_trace_chain_checked WHERE key = $1`, [k])).rows[0]?.status;
		expect(await row(`thor:${LOW}`)).toBe('done'); // a short history
		expect(await row(`thor:${BOT}`)).toBe('service'); // BOT is at hop 2 (medium): more than one check's budget of transactions
		expect((await sql.query<{ service: boolean }>(`SELECT service FROM oz_traced WHERE key = $1`, [`thor:${BOT}`])).rows[0].service).toBe(true);

		// a read whose deadline has passed reads one page, then says where to resume
		const index = await loadTraceIndex(sql);
		const listedOne = await checkChainHistory(new FakeChain(busy(LIST, 120, 500)), `thor:${LIST}`, 0, (k) => index.get(k), prices, DEFAULT_TRACE_CONFIG, {}, Date.now() - 1);
		expect(listedOne).toMatchObject({ txs: 50, more: true, service: false, maxHeight: 549 });
	});
});

describe('THORChain accounts that paid a listed address are linked to it', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());
	const key = loadPrivateKey(generateSigningKey().seedHex);

	const OFAC_ETH = '0x098b716b8aaf21512996dc57eb0615e2383e2f96'; // OFAC-listed (severe)
	const HACK_ETH = '0xa2e86997a730ed3efc49b40be139b2e736b0a36a'; // a hack listing (high)
	const PAYER = 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';
	const PAYER2 = 'thor1z4ypwv8hp829qka2nyur68k3d4jfgp3fp2eqkk';
	const listedEntry = (address: string, source: string, risk: 'severe' | 'high', category: ListEntry['category']): ListEntry => ({
		source,
		key: `evm:${address}`,
		chain: 'ETH',
		address,
		category,
		risk,
		code: source === 'ofac_sdn' ? 'OFAC_SDN' : 'HACK_LABEL',
		text: 'test listing'
	});

	const lookupFor = (entries: IndexEntry[]) => {
		const m = new Map(entries.map((e) => [e.key, e]));
		return (k: string) => m.get(k);
	};
	const listed = (key: string, hop = 0, originKey = key): IndexEntry => ({ key, hop, originRisk: 'high', originKey, originSource: 'ethlabels', originCategory: 'hack' });

	it('found from the listed side: a signed payment to a listed address is a link; a payment from it, to a same-key twin or by a contract is not', () => {
		const links: PayerLink[] = [];
		const lookup = lookupFor([listed(`evm:${OFAC_ETH}`), listed('tron:TAqg8TXo8tmpaz7TwHS669Tgt8MPSWgoxB', 0, `evm:${OFAC_ETH}`)]);
		const payment = (from: string, fromAsset: string, to: string, toAsset: string, type = 'secure') =>
			action({ type, height: 100, in: [{ address: from, asset: fromAsset, amount: 1_000 }], out: [{ address: to, asset: toAsset, amount: 1_000 }] });
		// SECURE- to the listed address
		traceAction(payment(PAYER, 'ETH-ETH', OFAC_ETH, 'ETH.ETH'), lookup, prices, DEFAULT_TRACE_CONFIG, undefined, (l) => links.push(l));
		expect(links).toEqual([expect.objectContaining({ thorAddress: PAYER, listedKey: `evm:${OFAC_ETH}`, address: OFAC_ETH, chain: 'ETH', action: 'secure' })]);
		links.length = 0;
		// the listed address paying the account is tracing, not a link
		traceAction(payment(OFAC_ETH, 'ETH.ETH', PAYER, 'ETH-ETH'), lookup, prices, DEFAULT_TRACE_CONFIG, undefined, (l) => links.push(l));
		// a same-key twin of a listing (TRON here) is too weak
		traceAction(payment(PAYER, 'TRON-TRX', 'TAqg8TXo8tmpaz7TwHS669Tgt8MPSWgoxB', 'TRON.TRX'), lookup, prices, DEFAULT_TRACE_CONFIG, undefined, (l) => links.push(l));
		// a contract (32-byte) paying it: no account
		traceAction(payment(FIN, 'THOR.RUNE', OFAC_ETH, 'ETH.ETH', 'swap'), lookup, prices, DEFAULT_TRACE_CONFIG, undefined, (l) => links.push(l));
		// a payment to a listed thor1 account: links are L1 addresses
		const listedThor = 'thor16ucjv3v695mq283me7esh0wdhajjalengcn84q';
		traceAction(action({ type: 'send', height: 100, in: [{ address: PAYER, asset: 'THOR.RUNE', amount: 1_000 }], out: [{ address: listedThor, asset: 'THOR.RUNE', amount: 1_000 }] }), lookupFor([listed(`thor:${listedThor}`)]), prices, DEFAULT_TRACE_CONFIG, undefined, (l) => links.push(l));
		expect(links).toEqual([]);
	});

	it('flows read from the chain count too (a contract swap toward a listed L1 address)', () => {
		const links: PayerLink[] = [];
		const tx = chainTx({
			height: 100,
			msgs: [{ signer: PAYER, transfers: [[PAYER, FIN, rune(1_000)]], wasm: [{ type: 'rujira-thorchain-swap/swap', attrs: { _contract_address: FIN, memo: `=:ETH.ETH:${OFAC_ETH}`, amount: rune(1_000) } }] }]
		});
		traceFlows(extractChainFlows(tx, prices), lookupFor([listed(`evm:${OFAC_ETH}`)]), DEFAULT_TRACE_CONFIG, undefined, (l) => links.push(l));
		expect(links).toEqual([expect.objectContaining({ thorAddress: PAYER, address: OFAC_ETH, action: CONTRACT_ACTION })]);
	});

	it('are recorded once, become monitored users, and the user screening flags them one risk level below the listing', async () => {
		const apply = (id: string, kind: string, e: ListEntry) => {
			const r = emptyResult();
			r.entries.push(e);
			return applySourceResult(sql, { id, name: id, kind }, r);
		};
		await apply('ofac_sdn', 'sanctions', listedEntry(OFAC_ETH, 'ofac_sdn', 'severe', 'sanctions'));
		await apply('ethlabels', 'community', listedEntry(HACK_ETH, 'ethlabels', 'high', 'hack'));
		const link = (thorAddress: string, address: string, txid: string): PayerLink => ({ thorAddress, listedKey: `evm:${address}`, address, chain: 'ETH', txid, height: 100, action: 'secure' });
		expect(await recordPayerLinks(sql, [link(PAYER, OFAC_ETH, 'T1'), link(PAYER, OFAC_ETH, 'T2'), link(PAYER2, HACK_ETH, 'T3')])).toBe(2);
		expect(await recordPayerLinks(sql, [link(PAYER, OFAC_ETH, 'T9')])).toBe(1); // a replay changes nothing
		expect((await sql.query(`SELECT 1 FROM l1_addresses`)).rows).toHaveLength(2);
		expect((await sql.query(`SELECT 1 FROM rujira_users`)).rows).toHaveLength(2);

		const s = await publishSnapshot(sql, key, { coreSources: [] });
		if (!s.published) throw new Error(s.reason);
		const row = await sql.query<{ manifest: unknown; payload: Uint8Array }>(`SELECT manifest, payload FROM oz_snapshots WHERE version = $1`, [s.version]);
		const idx: SnapshotIndex = decodePayload(verifyManifest(row.rows[0].manifest, [key.publicKey]), new Uint8Array(row.rows[0].payload));
		const r = await screenUsers(sql, idx);
		expect(r).toMatchObject({ flagged: 1, flaggedLinked: 1 });
		const users = await sql.query<{ thor_address: string; flagged: boolean; risk: string }>(`SELECT thor_address, flagged, risk FROM rujira_users`);
		const by = new Map(users.rows.map((u) => [u.thor_address, u]));
		expect(by.get(PAYER)).toMatchObject({ flagged: true, risk: 'high' }); // OFAC (severe) - 1
		expect(by.get(PAYER2)).toMatchObject({ flagged: false, risk: 'medium' }); // a hack listing (high) - 1: published, not flagged
		// the next snapshot publishes both as linked accounts
		const next = await publishSnapshot(sql, key, { coreSources: [] });
		if (!next.published) throw new Error(next.reason);
		expect(next.stats.linkedAccounts).toBe(2);
		// … and the coverage report (the numbers behind /api/stats) says so
		const report = await coverageReport(sql);
		expect(report.users).toMatchObject({ linkedAccounts: 2, linkedL1: 2 });
		expect(report.chain).toEqual({ cursor: null, cursorUpdatedAt: null, checkedAccounts: 0, pendingAccounts: 0 });
	});
});

describe('the history backfill after the change', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	const LISTED = '0x5a7034e8ee6b52f0246343cc48e529c0b5907f72';
	const PAYER = 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';
	const FLAGGED_THOR = 'thor1c3mxxtjksx8l7c3sjuzjelsdw34qsfj5vnzcp9';

	it('plans from what was checked, resets once per label, and the re-read finds what the old rules missed', async () => {
		const res = emptyResult();
		res.entries.push({ source: 'ethlabels', key: `evm:${LISTED}`, chain: 'ETH', address: LISTED, category: 'hack', risk: 'high', code: 'HACK_LABEL', entity: 'Test exploit', text: 't' });
		await applySourceResult(sql, { id: 'ethlabels', name: 'eth-labels', kind: 'community' }, res);
		const cur = emptyResult();
		cur.entries.push({ source: 'curated', key: `thor:${FLAGGED_THOR}`, chain: 'THOR', address: FLAGGED_THOR, category: 'hack', risk: 'high', code: 'INCIDENT_EXPLOITER', entity: 'Test exploit', text: 't' });
		await applySourceResult(sql, { id: 'curated', name: 'curated', kind: 'curated' }, cur);
		// state after the old code's backfill: the listed key was read (it has history), a service and a key without history were left alone
		await sql.query(
			`INSERT INTO oz_trace_checked (key, checked_height, checked_at, actions, status) VALUES
			 ($1, 4000, now(), 120, 'done'), ('evm:0xdead00000000000000000000000000000000beef', 900, now(), 5000, 'service'), ('evm:0xdead00000000000000000000000000000000cafe', 0, now(), 0, 'done')`,
			[`evm:${LISTED}`]
		);
		expect(await planTraceBackfill(sql)).toEqual({ midgardKeys: 1, listedKeys: 1, untouched: 2, chainKeys: 1, requestsAtLeast: 3 });

		expect(await maybeResetBackfill(sql, undefined)).toEqual({ applied: false, reset: 0 });
		expect(await maybeResetBackfill(sql, 'pass-f')).toEqual({ applied: true, reset: 1 });
		expect(await maybeResetBackfill(sql, 'pass-f')).toEqual({ applied: false, reset: 0 }); // once per label, however often the worker restarts
		const checks = await sql.query<{ key: string; status: string; checked_height: string }>(`SELECT key, status, checked_height FROM oz_trace_checked ORDER BY key`);
		expect(checks.rows.map((c) => [c.key.slice(-4), c.status, Number(c.checked_height)])).toEqual([
			[LISTED.slice(-4), 'pending', 0],
			['beef', 'service', 900], // services stay services
			['cafe', 'done', 0] // no history: nothing to read again
		]);

		// the read the new rules make: a thor1 account that paid the listed address in 2024 is now found from the listed side
		const payment = action({ type: 'secure', height: 3_000, in: [{ address: PAYER, asset: 'ETH-ETH', amount: 2 }], out: [{ address: LISTED, asset: 'ETH.ETH', amount: 2 }] });
		const r = await runTraceBackfill(sql, new FakeMidgard([payment]), { prices, filter: (k) => k === `evm:${LISTED}` });
		expect(r).toMatchObject({ checked: 1, links: 1 });
		const link = await sql.query<{ thor_address: string; l1_address: string }>(`SELECT thor_address, l1_address FROM l1_addresses`);
		expect(link.rows).toEqual([{ thor_address: PAYER, l1_address: LISTED }]);
		// and the flagged thor1 account's contract transactions are still to be read (nothing to reset for them)
		expect((await planTraceBackfill(sql)).chainKeys).toBe(1);
		await runChainBackfill(sql, new FakeChain([]), { prices, filter: (k) => k === `thor:${FLAGGED_THOR}` });
		expect((await planTraceBackfill(sql)).chainKeys).toBe(0);
	});

	it('a replayed edge keeps its hop and risk and only has its wording refreshed', async () => {
		const flow = {
			txid: 'REPLAYTX', height: 10, date: '2026-09-01T00:00:00.000Z', action: 'secure', relation: 'value' as const,
			fromKey: `evm:${LISTED}`, fromAddress: LISTED, fromChain: 'ETH', toKey: `thor:${PAYER}`, toAddress: PAYER, toChain: 'THOR', amount: '2 ETH-ETH', usd: 12_000,
			hop: 1, risk: 'high' as const, originKey: `evm:${LISTED}`, originSource: 'ethlabels', originRisk: 'high' as const, originCategory: 'hack' as const
		};
		await recordHits(sql, [flow]);
		await sql.query(`UPDATE oz_trace_edges SET reason = 'old wording' WHERE txid = 'REPLAYTX'`);
		await recordHits(sql, [flow]);
		const row = await sql.query<{ reason: string }>(`SELECT reason FROM oz_trace_edges WHERE txid = 'REPLAYTX'`);
		expect(row.rows).toHaveLength(1);
		expect(row.rows[0].reason).toMatch(/via THORChain secured-asset deposit \(SECURE\+\) REPLAYTX/);
		// a replay at another hop (the sender was traced closer meanwhile) does not rewrite the stored reason
		await sql.query(`UPDATE oz_trace_edges SET reason = 'kept', hop = 2 WHERE txid = 'REPLAYTX'`);
		await recordHits(sql, [flow]);
		expect((await sql.query<{ reason: string }>(`SELECT reason FROM oz_trace_edges WHERE txid = 'REPLAYTX'`)).rows[0].reason).toBe('kept');
	});
});
