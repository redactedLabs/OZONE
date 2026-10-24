import { describe, expect, it } from 'vitest';
import { activityOf, ChainError, ChainPair, proxyFactsOf, SourceReader } from './chain';
import { CHAIN_SOURCES, chainOrigins, parseDeployments } from './config';
import { allBalancesResponse, smartQueryRequest, smartQueryResponse } from './proto';
import { fakeNetwork, fixture } from './__fixtures__/fake-chain';

const PROXY = fixture.deployment.proxy;

describe('chain reads', () => {
	it('reads every feed of the proxy at one height, page by page, as a node serves them', async () => {
		const net = fakeNetwork();
		const r = new SourceReader(CHAIN_SOURCES[0], net.fetchFn);
		const rec = await r.feedRecords(PROXY, fixture.height);
		for (const k of ['notes', 'nullifiers', 'headers', 'accounts', 'slow', 'queue', 'deposits'] as const) expect(rec[k]).toEqual(fixture.feeds[k]);
		expect(rec.openings).toEqual([]);
		// every request was a pinned GET at the height
		for (const c of net.calls) expect(c.url).toContain(`height=${fixture.height}`);
	});

	it('E-59: refuses a page larger than asked and a cursor that does not move', async () => {
		const page = (records: unknown[]) => {
			const data = Buffer.from(Uint8Array.from([0x0a, ...varint(JSON.stringify({ notes: records }).length), ...Buffer.from(JSON.stringify({ notes: records }))])).toString('base64');
			return new Response(JSON.stringify({ result: { response: { code: 0, height: '5', value: data } } }));
		};
		const many = Array.from({ length: 201 }, (_, i) => ({ index: i }));
		const big = new SourceReader(CHAIN_SOURCES[0], async () => page(many));
		await expect(big.feedAll(PROXY, 'notes', 5)).rejects.toMatchObject({ code: 'REPLAY' });
		const stuck = new SourceReader(CHAIN_SOURCES[0], async () => page(Array.from({ length: 200 }, () => ({ index: 7 }))));
		await expect(stuck.feedAll(PROXY, 'notes', 5)).rejects.toMatchObject({ code: 'REPLAY' });
	});

	it('refuses an answer for another height', async () => {
		const r = new SourceReader(CHAIN_SOURCES[0], async () => new Response(JSON.stringify({ result: { response: { code: 0, height: '4', value: '' } } })));
		await expect(r.smartAt(PROXY, { config: {} }, 5)).rejects.toMatchObject({ code: 'REPLAY' });
	});

	it('pins the lower tip of two sources on the deployment chain, within ten blocks', async () => {
		const ok = new ChainPair(CHAIN_SOURCES, fixture.deployment.chain_id, PROXY, fakeNetwork({ tipB: fixture.height + 4 }).fetchFn);
		expect(await ok.tip()).toBe(fixture.height + 4);
		expect(ok.height).toBe(fixture.height);
		const far = new ChainPair(CHAIN_SOURCES, fixture.deployment.chain_id, PROXY, fakeNetwork({ tipB: fixture.height + 11 }).fetchFn);
		await expect(far.tip()).rejects.toBeInstanceOf(ChainError);
	});

	it('takes depositors and payees from the proxy own successful events only', () => {
		const txs = (fixture.txs as Record<string, unknown[]>)[PROXY]!;
		const facts = proxyFactsOf(txs, PROXY, 1, fixture.height);
		const C = fixture.counterparties;
		expect(new Set(facts.deposits.map((d) => d.source))).toEqual(new Set([C.wallet, C.exchange]));
		expect(facts.spends.map((s) => s.recipient)).toEqual([C.bob, C.spending, C.shop]);
		const acc = activityOf((fixture.txs as Record<string, unknown[]>)[C.spending]!, C.spending);
		expect(acc).toEqual([{ height: acc[0]!.height, hash: acc[0]!.hash, sent: [{ recipient: C.bob, amount: '100000000rune' }], called: [] }]);
	});

	it('encodes and decodes the protobuf of a smart query and of balances', () => {
		const req = smartQueryRequest(PROXY, { notes: { start_after: null, limit: 200 } });
		expect(Buffer.from(req).toString('latin1')).toContain(PROXY);
		const resp = Uint8Array.from([0x0a, 2, 0x7b, 0x7d]);
		expect(smartQueryResponse(resp)).toEqual({});
		const coin = [0x0a, 4, ...Buffer.from('rune'), 0x12, 3, ...Buffer.from('100')];
		expect(allBalancesResponse(Uint8Array.from([0x0a, coin.length, ...coin]))).toEqual([{ denom: 'rune', amount: '100' }]);
	});

	it('connects only to the two chain sources, run by different operators', () => {
		expect(chainOrigins()).toEqual(['https://rpc.redacted.money', 'https://gateway.liquify.com']);
	});

	it('reads only well-formed deployments from the environment', () => {
		const good = { chain_id: 'thorchain-1', proxy: PROXY };
		expect(parseDeployments(JSON.stringify([good, { chain_id: 'x', proxy: 'not an address' }, { proxy: PROXY }, 5]))).toEqual([{ ...good, hrp: 'thor' }]);
		expect(parseDeployments(undefined)).toEqual([]);
		expect(parseDeployments('{oops')).toEqual([]);
	});
});

function varint(n: number): number[] {
	const out: number[] = [];
	while (n >= 0x80) {
		out.push((n & 0x7f) | 0x80);
		n >>>= 7;
	}
	out.push(n);
	return out;
}
