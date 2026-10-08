/**
 * The EVM log reader behind the stablecoin and oracle sources (evmlogs.ts):
 * the failures of 2026-10-06 (Blockscout behind a Cloudflare challenge, a Base
 * RPC that serves 1,000 blocks per call) and how the reader gets around them —
 * without getting around the challenge: other endpoints, learned block-range
 * limits, a stored history read in small ranges and resumed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseRangeLimit, readContractLogs, resetLearnedRanges, HistoryInProgress, type ChainLogConfig } from '../src/sources/evmlogs.js';
import { chainLogConfig, syncCircle, syncUsdt0, TOPICS, USDT0_EVM, CIRCLE_EVM } from '../src/sources/events.js';
import { memoryDb } from './helpers.js';

const CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ADD = TOPICS.Blacklisted;
const REMOVE = TOPICS.UnBlacklisted;
const word = (addr: string) => '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

interface ChainLog {
	block: number;
	topic0: string;
	topic1: string;
	tx: string;
	contract?: string;
}

type Refusal = (span: number, from: number) => { status: number; body: unknown } | undefined;

/**
 * Fake JSON-RPC endpoints by host: a chain with `head` and `logs`, each host
 * with its own refusal rule (range limits in the dialects measured on
 * 2026-10-07) and a call log.
 */
function fakeChain(head: number, logs: ChainLog[], hosts: Record<string, { refuse?: Refusal; timestamps?: boolean; down?: boolean; html403?: boolean }>) {
	const calls: Array<{ host: string; method: string; from?: number; to?: number }> = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const h = hosts[`${url.host}${url.pathname.replace(/\/+$/, '')}`] ?? hosts[url.host];
		if (!h) return new Response('unknown host', { status: 404 });
		if (h.html403) return new Response('<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>', { status: 403, headers: { 'content-type': 'text/html' } });
		if (h.down) return new Response('down', { status: 503 });
		const body = JSON.parse(String(init?.body ?? '{}'));
		const one = (req: { id: number; method: string; params: unknown[] }) => {
			if (req.method === 'eth_blockNumber') {
				calls.push({ host: url.host, method: req.method });
				return { status: 200, body: { jsonrpc: '2.0', id: req.id, result: '0x' + head.toString(16) } };
			}
			if (req.method === 'eth_getBlockByNumber') {
				calls.push({ host: url.host, method: req.method });
				const bn = parseInt(String(req.params[0]), 16);
				return { status: 200, body: { jsonrpc: '2.0', id: req.id, result: { timestamp: '0x' + (1_700_000_000 + bn).toString(16) } } };
			}
			if (req.method === 'eth_getLogs') {
				const q = req.params[0] as { address: string; topics: Array<string | string[]>; fromBlock: string; toBlock: string };
				const from = parseInt(q.fromBlock, 16);
				const to = parseInt(q.toBlock, 16);
				calls.push({ host: url.host, method: req.method, from, to });
				const refusal = h.refuse?.(to - from + 1, from);
				if (refusal) return refusal;
				const wanted = new Set((Array.isArray(q.topics[0]) ? q.topics[0] : [q.topics[0]]).map((t) => String(t).toLowerCase()));
				const result = logs
					.filter((l) => l.block >= from && l.block <= to && wanted.has(l.topic0) && (l.contract ?? CONTRACT) === q.address.toLowerCase())
					.map((l, i) => ({
						address: l.contract ?? CONTRACT,
						blockNumber: '0x' + l.block.toString(16),
						logIndex: '0x' + i.toString(16),
						transactionHash: l.tx,
						topics: [l.topic0, l.topic1],
						data: '0x',
						...(h.timestamps ? { blockTimestamp: '0x' + (1_700_000_000 + l.block).toString(16) } : {})
					}));
				return { status: 200, body: { jsonrpc: '2.0', id: req.id, result } };
			}
			return { status: 200, body: { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } } };
		};
		if (Array.isArray(body)) return new Response(JSON.stringify(body.map((r) => one(r).body)));
		const r = one(body);
		return new Response(JSON.stringify(r.body), { status: r.status });
	}) as typeof fetch;
	return { fetchImpl, calls };
}

const tenderly1000: Refusal = (span) =>
	span > 1001 ? { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid params', data: 'Block range too large for public access: maximum 1000 blocks. Try with this block range [0x0, 0x3e8].' } } } : undefined;
const drpc10k: Refusal = (span) => (span > 10_000 ? { status: 400, body: { message: 'ranges over 10000 blocks are not supported on free plan', code: 35 } } : undefined);
const baseOrg500: Refusal = (span) => (span > 500 ? { status: 413, body: { jsonrpc: '2.0', id: 1, error: { code: -32614, message: 'eth_getLogs is limited to a 500 range' } } } : undefined);
const archiveToken: Refusal = () => ({ status: 403, body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode' } } });

function config(providers: ChainLogConfig['providers'], finality = 10): ChainLogConfig {
	return { chain: 'BASE', providers, finality, txUrl: (h) => h };
}

afterEach(() => resetLearnedRanges());

describe('range limits named in refusals', () => {
	it('reads the dialects measured on 2026-10-07', () => {
		expect(parseRangeLimit('invalid params Block range too large for public access: maximum 1000 blocks. Try with this block range')).toBe(1000);
		expect(parseRangeLimit('HTTP 400 ranges over 10000 blocks are not supported on free plan')).toBe(10_000);
		expect(parseRangeLimit('eth_getLogs is limited to a 500 range')).toBe(500);
		expect(parseRangeLimit('eth_getLogs is limited to 0 - 50 blocks range')).toBe(50);
		expect(parseRangeLimit('query spans 511999989 blocks (681361 to 512681349), but only 10000000 are allowed for this request')).toBe(10_000_000);
		expect(parseRangeLimit('exceed maximum block range: 50000')).toBe(50_000);
		expect(parseRangeLimit('You can make eth_getLogs requests with up to a 10 block range.')).toBe(10);
		expect(parseRangeLimit('Block range too large: maximum allowed is 50 blocks on your current plan')).toBe(50);
		expect(parseRangeLimit('service temporarily unavailable')).toBeUndefined();
	});
});

describe('readContractLogs', () => {
	const logs: ChainLog[] = [
		{ block: 1_200, topic0: ADD, topic1: word(A), tx: '0xa1' },
		{ block: 25_000, topic0: ADD, topic1: word(B), tx: '0xb1' },
		{ block: 47_000, topic0: REMOVE, topic1: word(B), tx: '0xb2' }
	];

	it('replays the whole history on an endpoint that allows it; an explorer behind a challenge page is never needed', async () => {
		const { fetchImpl, calls } = fakeChain(50_000, logs, { 'full.rpc': { timestamps: true }, 'challenged.explorer': { html403: true } });
		const r = await readContractLogs(
			{ config: config([{ kind: 'rpc', url: 'https://full.rpc/', minIntervalMs: 0 }, { kind: 'explorer', url: 'https://challenged.explorer/api', minIntervalMs: 0 }]), contract: CONTRACT, topics: [ADD, REMOVE] },
			{ fetch: fetchImpl, retries: 0 }
		);
		expect(r.mode).toBe('full');
		expect(r.logs.map((l) => l.transactionHash)).toEqual(['0xa1', '0xb1', '0xb2']);
		expect(calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(1); // both events in one call
		expect(calls.some((c) => c.host === 'challenged.explorer')).toBe(false);
	});

	it('2026-10-06: Blockscout answers a challenge page and the only Base RPC serves 1,000 blocks: no replay, a clear error without a database', async () => {
		const { fetchImpl } = fakeChain(50_000, logs, { 'tenderly.base': { refuse: tenderly1000, timestamps: true }, 'base.blockscout': { html403: true } });
		await expect(
			readContractLogs(
				{
					config: config([{ kind: 'rpc', url: 'https://tenderly.base/', minIntervalMs: 0 }, { kind: 'explorer', url: 'https://base.blockscout/api', minIntervalMs: 0 }]),
					contract: CONTRACT,
					topics: [ADD, REMOVE]
				},
				{ fetch: fetchImpl, retries: 0, fullReplayMaxCalls: 20 }
			)
		).rejects.toThrow(/no endpoint could read the event history.*serves at most 1000 blocks/);
	});

	it('learns each endpoint limit from its refusal, skips endpoints that want a key, and reads the history in ranges they accept', async () => {
		const { sql } = await memoryDb();
		const { fetchImpl, calls } = fakeChain(50_000, logs, {
			'publicnode.base': { refuse: archiveToken },
			'drpc.base': { refuse: drpc10k },
			'base.blockscout': { html403: true }
		});
		const cfg = config([
			{ kind: 'rpc', url: 'https://publicnode.base/', minIntervalMs: 0 },
			{ kind: 'rpc', url: 'https://drpc.base/', minIntervalMs: 0 },
			{ kind: 'explorer', url: 'https://base.blockscout/api', minIntervalMs: 0 }
		]);
		const r = await readContractLogs({ config: cfg, contract: CONTRACT, topics: [ADD, REMOVE], fromBlock: 1_000 }, { fetch: fetchImpl, retries: 0, sql, fullReplayMaxCalls: 3 });
		expect(r.mode).toBe('bootstrap');
		expect(r.logs.map((l) => l.transactionHash)).toEqual(['0xa1', '0xb1', '0xb2']);
		expect(r.logs[0].timeStamp).toBe(1_700_000_000 + 1_200); // from eth_getBlockByNumber
		const drpc = calls.filter((c) => c.host === 'drpc.base' && c.method === 'eth_getLogs');
		// every range after the first refusal fits the learned limit, from the deployment block on
		expect(drpc.slice(1).every((c) => c.to! - c.from! + 1 <= 10_000)).toBe(true);
		expect(Math.min(...drpc.map((c) => c.from!))).toBe(1_000);

		// the next sync only reads what is new (stored history), a 1,000-block endpoint is enough now
		calls.length = 0;
		const later = fakeChain(52_000, [...logs, { block: 51_000, topic0: ADD, topic1: word(B), tx: '0xb3' }], {
			'tenderly.base': { refuse: tenderly1000, timestamps: true },
			'base.blockscout': { html403: true }
		});
		const cfg2 = config([
			{ kind: 'rpc', url: 'https://tenderly.base/', minIntervalMs: 0 },
			{ kind: 'explorer', url: 'https://base.blockscout/api', minIntervalMs: 0 }
		]);
		const r2 = await readContractLogs({ config: cfg2, contract: CONTRACT, topics: [ADD, REMOVE], fromBlock: 1_000 }, { fetch: later.fetchImpl, retries: 0, sql, fullReplayMaxCalls: 3 });
		expect(r2.mode).toBe('incremental');
		expect(r2.logs.map((l) => l.transactionHash)).toEqual(['0xa1', '0xb1', '0xb2', '0xb3']);
		const read = later.calls.filter((c) => c.method === 'eth_getLogs' && c.to! - c.from! + 1 <= 1001);
		expect(Math.min(...read.map((c) => c.from!))).toBeGreaterThan(49_000); // from where the stored history ended (head − finality)
	});

	it('a history that does not fit the time budget is resumed at the next sync; until then the read fails with its progress', async () => {
		const { sql } = await memoryDb();
		const { fetchImpl } = fakeChain(50_000, logs, { 'baseorg.rpc': { refuse: baseOrg500 } });
		const cfg = config([{ kind: 'rpc', url: 'https://baseorg.rpc/', minIntervalMs: 0 }]);
		let t = 0;
		const now = () => (t += 1_000); // every call to the clock is one second
		await expect(
			readContractLogs({ config: cfg, contract: CONTRACT, topics: [ADD, REMOVE], fromBlock: 1_000 }, { fetch: fetchImpl, retries: 0, sql, now, budgetMs: 30_000, fullReplayMaxCalls: 3 })
		).rejects.toBeInstanceOf(HistoryInProgress);
		const stored = (await sql.query<{ value: { to: number; complete: boolean } }>(`SELECT value FROM oz_state WHERE id LIKE 'evmlogs:v1:BASE:%'`)).rows[0].value;
		expect(stored.to).toBeGreaterThan(1_000);
		expect(stored.complete).toBe(false);
		// resumed: the next reads continue from there until the head
		let r;
		for (let i = 0; i < 20 && !r; i++) {
			r = await readContractLogs({ config: cfg, contract: CONTRACT, topics: [ADD, REMOVE], fromBlock: 1_000 }, { fetch: fetchImpl, retries: 0, sql, now, budgetMs: 60_000, fullReplayMaxCalls: 3 }).catch((e) => {
				if (!(e instanceof HistoryInProgress)) throw e;
				return undefined;
			});
		}
		expect(r?.logs.map((l) => l.transactionHash)).toEqual(['0xa1', '0xb1', '0xb2']);
	});

	it('refuses a replay that lacks a log the stored history has (an endpoint without the old blocks), and uses the next endpoint', async () => {
		const { sql } = await memoryDb();
		const first = fakeChain(50_000, logs, { 'full.rpc': { timestamps: true } });
		const cfg = (hosts: string[]) => config(hosts.map((h) => ({ kind: 'rpc' as const, url: `https://${h}/`, minIntervalMs: 0 })));
		await readContractLogs({ config: cfg(['full.rpc']), contract: CONTRACT, topics: [ADD, REMOVE] }, { fetch: first.fetchImpl, retries: 0, sql });
		// a pruned endpoint answers "no logs" below block 20,000; a complete one comes next
		const pruned: Refusal = () => undefined;
		const both = fakeChain(50_100, logs, { 'pruned.rpc': { refuse: pruned, timestamps: true }, 'full.rpc': { timestamps: true } });
		const prunedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			if (url.host === 'pruned.rpc') {
				const body = JSON.parse(String(init?.body ?? '{}'));
				if (body.method === 'eth_getLogs') {
					const res = await both.fetchImpl(input, init);
					const j = (await res.json()) as { result: Array<{ blockNumber: string }> };
					return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: j.result.filter((l) => parseInt(l.blockNumber, 16) >= 20_000) }));
				}
			}
			return both.fetchImpl(input, init);
		}) as typeof fetch;
		const r = await readContractLogs({ config: cfg(['pruned.rpc', 'full.rpc']), contract: CONTRACT, topics: [ADD, REMOVE] }, { fetch: prunedFetch, retries: 0, sql });
		expect(r.provider).toBe('full.rpc');
		expect(r.logs.map((l) => l.transactionHash)).toContain('0xa1');
	});

	it('drops logs for another contract or event, whichever endpoint returned them', async () => {
		const other = '0x9999999999999999999999999999999999999999';
		const injected = fakeChain(50_000, logs, { 'full.rpc': { timestamps: true } });
		const lying = (async (input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (body.method === 'eth_getLogs') {
				return new Response(
					JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: [
							{ address: CONTRACT, blockNumber: '0x10', logIndex: '0x0', transactionHash: '0xok', topics: [ADD, word(A)], data: '0x', blockTimestamp: '0x1' },
							{ address: other, blockNumber: '0x11', logIndex: '0x0', transactionHash: '0xbad1', topics: [ADD, word(B)], data: '0x', blockTimestamp: '0x1' },
							{ address: CONTRACT, blockNumber: '0x12', logIndex: '0x0', transactionHash: '0xbad2', topics: [TOPICS.Blacklisted.replace('f', 'e'), word(B)], data: '0x', blockTimestamp: '0x1' }
						]
					})
				);
			}
			return injected.fetchImpl(input, init);
		}) as typeof fetch;
		const r = await readContractLogs({ config: config([{ kind: 'rpc', url: 'https://full.rpc/', minIntervalMs: 0 }]), contract: CONTRACT, topics: [ADD, REMOVE] }, { fetch: lying, retries: 0 });
		expect(r.logs.map((l) => l.transactionHash)).toEqual(['0xok']);
		expect(r.dropped).toBe(2);
	});
});

describe('the sources on their new endpoints', () => {
	it('every chain has public RPC endpoints before its explorer; Base has a stored history path (deployment blocks known)', () => {
		for (const chain of ['ETH', 'BASE', 'AVAX', 'ARB', 'OP', 'POL']) {
			const cfg = chainLogConfig(chain, {});
			expect(cfg.providers[0].kind).toBe('rpc');
			expect(cfg.providers.filter((p) => p.kind === 'rpc').length).toBeGreaterThanOrEqual(3);
			expect(cfg.providers.at(-1)!.kind).toBe('explorer');
		}
		expect(CIRCLE_EVM.find((c) => c.chain === 'BASE')?.fromBlock).toBe(2_797_221);
		// an owner's Blockscout key is only used when it is set
		expect(chainLogConfig('ARB', {}).providers.some((p) => p.url.includes('api.blockscout.com'))).toBe(false);
		expect(chainLogConfig('ARB', { BLOCKSCOUT_API_KEY: 'k' }).providers.find((p) => p.url.includes('api.blockscout.com'))?.params).toMatchObject({ chain_id: '42161' });
	});

	it('tether_usdt0 recovers from Tenderly while arbitrum/polygon Blockscout answer challenge pages', async () => {
		const [arb, pol] = USDT0_EVM;
		const C = '0x3333333333333333333333333333333333333333';
		const arbChain = fakeChain(400_000_000, [{ block: 300_000_000, topic0: TOPICS.BlockPlaced, topic1: word(C), tx: '0xc1', contract: arb.contract.toLowerCase() }], {
			'gateway.tenderly.co': { timestamps: true },
			'arbitrum.blockscout.com': { html403: true },
			'polygon.blockscout.com': { html403: true }
		});
		const res = await syncUsdt0({ fetch: arbChain.fetchImpl, retries: 0, env: {} });
		expect(res.entries.map((e) => e.key)).toEqual([`evm:${C}`]);
		expect(pol.chain).toBe('POL');
		expect(arbChain.calls.some((c) => c.host.includes('blockscout'))).toBe(false);
	});

	it('circle fails visibly (and keeps its entries) while the Base history is still being read', async () => {
		const { sql } = await memoryDb();
		const hosts = {
			'gateway.tenderly.co/public/mainnet': { timestamps: true },
			'gateway.tenderly.co/public/base': { refuse: tenderly1000, timestamps: true },
			'base.blockscout.com': { html403: true }
		};
		const { fetchImpl } = fakeChain(60_000_000, [], hosts);
		let t = 0;
		await expect(syncCircle({ fetch: fetchImpl, retries: 0, sql, env: {}, now: () => (t += 60_000), budgetMs: 120_000 })).rejects.toThrow(/BASE .*reading the event history in small block ranges, \d+% done/);
	});

	it('Base after 2026-10-06: the stored history is seeded from what circle last published, then extended in 1,000-block ranges', async () => {
		const { sql } = await memoryDb();
		const head = 60_000_000;
		// the fake chain's block b has timestamp 1.7e9 + b: the last success maps to block 59,990,000 + 3,600
		const lastSuccess = new Date((1_700_000_000 + 59_990_000 + 3_600) * 1000);
		const C = '0x3333333333333333333333333333333333333333';
		await sql.query(`INSERT INTO oz_sources (id, name, kind, last_success_at, active_count) VALUES ('circle', 'Circle', 'stablecoin', $1, 2)`, [lastSuccess]);
		const entry = (address: string, chains: unknown[], removedAt: string | null) =>
			sql.query(
				`INSERT INTO oz_entries (source, key, chain, address, category, risk, code, reason, meta, removed_at, first_seen, last_seen)
				 VALUES ('circle', $1, 'BASE', $2, 'stablecoin_freeze', 'high', 'CIRCLE_BLACKLISTED', 'x', $3, $4, now(), now())`,
				[`evm:${address}`, address, JSON.stringify({ chains }), removedAt]
			);
		await entry(A, [{ chain: 'BASE', frozenAt: '2025-01-01T00:00:00.000Z', tx: '0xseedA' }], null);
		await entry(B, [{ chain: 'BASE', frozenAt: '2025-02-01T00:00:00.000Z', tx: '0xseedB', releasedAt: '2025-03-01T00:00:00.000Z', releaseTx: '0xseedB2' }], '2025-03-01T00:00:00.000Z');
		const hosts = {
			'gateway.tenderly.co/public/mainnet': { timestamps: true },
			'gateway.tenderly.co/public/avalanche': { timestamps: true },
			'gateway.tenderly.co/public/base': { refuse: tenderly1000, timestamps: true },
			'base.blockscout.com': { html403: true }
		};
		const fresh: ChainLog = { block: 59_995_000, topic0: ADD, topic1: word(C), tx: '0xnewC', contract: CIRCLE_EVM[1].contract.toLowerCase() };
		const { fetchImpl, calls } = fakeChain(head, [fresh], hosts);
		const res = await syncCircle({ fetch: fetchImpl, retries: 0, sql, env: {} });
		const byAddress = new Map(res.entries.map((e) => [e.address, e]));
		expect(byAddress.get(A)?.removedAt).toBeUndefined();
		expect(byAddress.get(B)?.removedAt).toBe('2025-03-01T00:00:00.000Z');
		expect(byAddress.get(C)?.listedAt).toBe(new Date((1_700_000_000 + 59_995_000) * 1000).toISOString());
		// only the blocks after the seed were read, in ranges the endpoint accepts
		const baseReads = calls.filter((c) => c.method === 'eth_getLogs' && c.to! - c.from! + 1 <= 1000);
		expect(Math.min(...baseReads.map((c) => c.from!))).toBeGreaterThanOrEqual(59_990_000);
		const stored = (await sql.query<{ value: { to: number; complete: boolean } }>(`SELECT value FROM oz_state WHERE id = $1`, [`evmlogs:v1:BASE:${CIRCLE_EVM[1].contract.toLowerCase()}`])).rows[0].value;
		expect(stored.complete).toBe(true);
		expect(stored.to).toBe(head - 450);
	});
});

