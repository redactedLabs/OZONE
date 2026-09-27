/**
 * Sources added in pass D: the sanctions oracle on its other chains, USDC
 * on Arbitrum/Optimism/Polygon, USDT0 freezes, and the optional,
 * key-gated Chainabuse reports.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { CORE_SOURCES, SOURCES, activeSources, sourceById } from '../src/sources/registry.js';
import {
	CIRCLE_OTHER_EVM,
	LOG_APIS,
	ORACLE_OTHER_DEPLOYMENTS,
	TOPICS,
	USDT0_EVM,
	syncCircleOtherChains,
	syncOracleOtherChains,
	syncUsdt0
} from '../src/sources/events.js';
import { parseChainabuseReports, syncChainabuse, type ChainabuseReport } from '../src/sources/chainabuse.js';
import { parseEthLabels } from '../src/sources/community.js';
import { applySourceResult } from '../src/store/entries.js';
import { memoryDb } from './helpers.js';

const word = (addr: string) => '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const addressArray = (addrs: string[]) =>
	'0x' + [32, addrs.length].map((n) => n.toString(16).padStart(64, '0')).join('') + addrs.map((a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')).join('');

interface FakeLog {
	host: string;
	contract: string;
	topic0: string;
	block: number;
	time: number;
	tx: string;
	topic1?: string;
	data?: string;
}

/** An Etherscan-compatible explorer (`module=logs&action=getLogs`) answering from a list; `down` hosts answer 500. */
function explorerFetch(logs: FakeLog[], down: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (down.includes(url.host)) return new Response('unavailable', { status: 500 });
		const address = (url.searchParams.get('address') ?? '').toLowerCase();
		const topic0 = (url.searchParams.get('topic0') ?? '').toLowerCase();
		const result = logs
			.filter((l) => l.host === url.host && l.contract.toLowerCase() === address && l.topic0 === topic0)
			.map((l, i) => ({
				blockNumber: '0x' + l.block.toString(16),
				logIndex: '0x' + i.toString(16),
				timeStamp: '0x' + l.time.toString(16),
				transactionHash: l.tx,
				address: l.contract,
				topics: [l.topic0, ...(l.topic1 ? [l.topic1] : [])],
				data: l.data ?? '0x'
			}));
		return new Response(JSON.stringify(result.length ? { status: '1', message: 'OK', result } : { status: '0', message: 'No logs found', result: [] }));
	}) as typeof fetch;
}

const host = (chain: keyof typeof LOG_APIS) => new URL(LOG_APIS[chain].api).host;
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';

describe('USDT0 freezes (Arbitrum, Polygon)', () => {
	it('folds BlockPlaced/BlockReleased per chain into active and released entries', async () => {
		const [arb, pol] = USDT0_EVM;
		const logs: FakeLog[] = [
			{ host: host('ARB'), contract: arb.contract, topic0: TOPICS.BlockPlaced, block: 10, time: 1_760_000_000, tx: '0xa1', topic1: word(A) },
			{ host: host('POL'), contract: pol.contract, topic0: TOPICS.BlockPlaced, block: 20, time: 1_760_000_100, tx: '0xb1', topic1: word(B) },
			{ host: host('POL'), contract: pol.contract, topic0: TOPICS.BlockReleased, block: 30, time: 1_760_000_200, tx: '0xb2', topic1: word(B) }
		];
		const res = await syncUsdt0({ fetch: explorerFetch(logs), retries: 0 });
		const a = res.entries.find((e) => e.address === A)!;
		const b = res.entries.find((e) => e.address === B)!;
		expect(a).toMatchObject({ source: 'tether_usdt0', key: `evm:${A}`, category: 'stablecoin_freeze', risk: 'high', code: 'USDT0_FROZEN', chain: 'ARB' });
		expect(a.text).toMatch(/frozen on ARB/);
		expect(a.removedAt).toBeUndefined();
		expect(b.removedAt).toBe(new Date(1_760_000_200 * 1000).toISOString());
	});
});

describe('Circle USDC on Arbitrum, Optimism, Polygon', () => {
	it('an address blacklisted on two chains and released on one stays active', async () => {
		const [arb, op] = CIRCLE_OTHER_EVM;
		const logs: FakeLog[] = [
			{ host: host('ARB'), contract: arb.contract, topic0: TOPICS.Blacklisted, block: 10, time: 1_750_000_000, tx: '0xc1', topic1: word(C) },
			{ host: host('OP'), contract: op.contract, topic0: TOPICS.Blacklisted, block: 11, time: 1_750_000_010, tx: '0xc2', topic1: word(C) },
			{ host: host('OP'), contract: op.contract, topic0: TOPICS.UnBlacklisted, block: 12, time: 1_750_000_020, tx: '0xc3', topic1: word(C) }
		];
		const res = await syncCircleOtherChains({ fetch: explorerFetch(logs), retries: 0 });
		expect(res.entries).toHaveLength(1);
		expect(res.entries[0]).toMatchObject({ source: 'circle_other_chains', code: 'CIRCLE_BLACKLISTED', key: `evm:${C}` });
		expect(res.entries[0].removedAt).toBeUndefined();
		expect(res.entries[0].text).toMatch(/on ARB/);
	});
});

describe('Chainalysis oracle on its other chains', () => {
	const add = (chain: keyof typeof LOG_APIS, contract: string, addrs: string[], block: number, tx: string): FakeLog => ({
		host: host(chain),
		contract,
		topic0: TOPICS.SanctionedAddressesAdded,
		block,
		time: 1_700_000_000 + block,
		tx,
		data: addressArray(addrs)
	});

	it('reads every deployment (Base at its own address) and folds additions and removals', async () => {
		const byChain = Object.fromEntries(ORACLE_OTHER_DEPLOYMENTS.map((d) => [d.chain, d.contract]));
		expect(byChain.BASE).toBe('0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B');
		const logs: FakeLog[] = [
			add('ARB', byChain.ARB, [A, B], 5, '0xd1'),
			add('BASE', byChain.BASE, [A], 6, '0xd2'),
			{ host: host('BASE'), contract: byChain.BASE, topic0: TOPICS.SanctionedAddressesRemoved, block: 7, time: 1_700_000_007, tx: '0xd3', data: addressArray([A]) }
		];
		const res = await syncOracleOtherChains({ fetch: explorerFetch(logs), retries: 0 });
		const a = res.entries.find((e) => e.address === A)!;
		const b = res.entries.find((e) => e.address === B)!;
		expect(a).toMatchObject({ source: 'chainalysis_oracle_other_chains', category: 'sanctions', risk: 'severe' });
		// removed on Base, still listed on Arbitrum
		expect(a.removedAt).toBeUndefined();
		expect(a.text).toMatch(/on ARB/);
		expect(b.removedAt).toBeUndefined();
	});

	it('refuses a partial read: one deployment down fails the whole sync (nothing is delisted)', async () => {
		await expect(syncOracleOtherChains({ fetch: explorerFetch([], [host('OP')]), retries: 0 })).rejects.toThrow();
	});
});

describe('registry: new sources and optional key-gated ones', () => {
	it('adds the other-chain feeds as non-core sources with a cadence', () => {
		for (const id of ['chainalysis_oracle_other_chains', 'tether_usdt0', 'circle_other_chains', 'chainabuse']) {
			const s = sourceById(id);
			expect(s, id).toBeDefined();
			expect(CORE_SOURCES).not.toContain(id);
			expect(s!.cadence, id).toBeTruthy();
		}
	});

	it('schedules Chainabuse only when its key is set', () => {
		expect(activeSources({}).map((s) => s.id)).not.toContain('chainabuse');
		expect(activeSources({ CHAINABUSE_API_KEY: 'k' }).map((s) => s.id)).toContain('chainabuse');
		expect(activeSources({}).length).toBe(SOURCES.length - 1);
	});
});

describe('Chainabuse reports', () => {
	const reports: ChainabuseReport[] = [
		{
			id: 'r1',
			checked: true,
			trusted: true,
			scamCategory: 'PHISHING',
			createdAt: '2026-09-01T00:00:00Z',
			addresses: [
				{ address: '0x51E9d833Ecae4E8D9D8Be17300AEE6D3398C135D', chain: 'ETH' },
				{ address: 'EQD-some-ton-address', chain: 'TON' }, // chain Ozone does not screen: skipped
				{ domain: 'phish.example' }
			]
		},
		{ id: 'r2', checked: false, scamCategory: 'ROMANCE', addresses: [{ address: '3LU8wRu4ZnXP4UM8Yo6kkTiGHM9BubgyiG', chain: 'BTC' }] }, // not verified
		{ id: 'r3', checked: true, scamCategory: 'RUG_PULL', createdAt: '2026-09-02T00:00:00Z', addresses: [{ address: 'bc1qnotvalid', chain: 'BTC' }] }
	];

	it('keeps moderator-verified reports only, validates addresses, maps categories', () => {
		const res = parseChainabuseReports(reports);
		expect(res.entries).toHaveLength(1);
		expect(res.entries[0]).toMatchObject({
			source: 'chainabuse',
			key: 'evm:0x51e9d833ecae4e8d9d8be17300aee6d3398c135d',
			category: 'phishing',
			risk: 'medium',
			code: 'CHAINABUSE_REPORT',
			refUrl: 'https://www.chainabuse.com/report/r1'
		});
		expect(res.rejected.map((r) => r.raw)).toEqual(['bc1qnotvalid']);
	});

	describe('incremental sync', async () => {
		const { db, sql } = await memoryDb();
		afterAll(() => db.close());

		it('reads only newer reports with basic auth, keeps what earlier syncs stored', async () => {
			const def = sourceById('chainabuse')!;
			await applySourceResult(sql, def, parseChainabuseReports(reports));
			const seen: Array<{ url: URL; auth: string | null }> = [];
			const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(String(input));
				seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
				return new Response(
					JSON.stringify({
						reports: [
							{ id: 'r9', checked: true, scamCategory: 'SEXTORTION', createdAt: '2026-09-20T00:00:00Z', addresses: [{ address: 'TUCsTq7TofTCJRRoHk6RvhMoS2mJLm5Yzq', chain: 'TRON' }] }
						]
					})
				);
			}) as typeof fetch;
			const res = await syncChainabuse({ sql, apiKey: 'test-key', fetch: fetchStub, retries: 0 });
			expect(res.entries.map((e) => e.key).sort()).toEqual(['evm:0x51e9d833ecae4e8d9d8be17300aee6d3398c135d', 'tron:TUCsTq7TofTCJRRoHk6RvhMoS2mJLm5Yzq']);
			expect(seen).toHaveLength(1);
			expect(seen[0].url.host).toBe('api.chainabuse.com');
			expect(seen[0].url.searchParams.get('checked')).toBe('true');
			expect(seen[0].url.searchParams.get('since')).toBe('2026-08-25T00:00:00.000Z'); // newest stored minus a week
			expect(seen[0].url.toString()).not.toContain('test-key');
			expect(seen[0].auth).toBe(`Basic ${Buffer.from('test-key:').toString('base64')}`);
		});

		it('refuses to run without a key', async () => {
			const prev = process.env.CHAINABUSE_API_KEY;
			delete process.env.CHAINABUSE_API_KEY;
			await expect(syncChainabuse({ sql })).rejects.toThrow(/not set/);
			if (prev !== undefined) process.env.CHAINABUSE_API_KEY = prev;
		});
	});
});

describe('eth-labels: a newly labelled heist is imported without a code change', () => {
	it('takes an unknown <incident>-exploit / -hack slug as a hack attribution, but never a victim', () => {
		const res = parseEthLabels([
			{ address: '0x4444444444444444444444444444444444444444', chainId: 1, label: 'kelpdao-exploit', nameTag: 'KelpDAO Exploiter 1' },
			{ address: '0x5555555555555555555555555555555555555555', chainId: 42161, label: 'someprotocol-hack', nameTag: 'Compromised: SomeProtocol deployer' },
			{ address: '0x6666666666666666666666666666666666666666', chainId: 1, label: 'uniswap', nameTag: 'Uniswap V3: Router' },
			{ address: '0x7777777777777777777777777777777777777777', chainId: 1, label: 'cpimp-attack', nameTag: 'Compromised: 0x777' }
		]);
		expect(res.entries.map((e) => [e.key, e.category, e.risk])).toEqual([['evm:0x4444444444444444444444444444444444444444', 'hack', 'high']]);
		expect(res.notes.join(' ')).toMatch(/new incident label kelpdao-exploit/);
		expect(res.notes.join(' ')).toMatch(/skipped 1 entries labelled someprotocol-hack/);
	});
});
