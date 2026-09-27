/**
 * Upstream event sources are unauthenticated (keyless public RPC gateways,
 * explorer APIs, TronGrid): a single misbehaving or compromised endpoint
 * must not be able to inject a delisting or a fabricated freeze by returning
 * a log/event for a different contract, topic or event name than requested.
 */
import { describe, expect, it } from 'vitest';
import { fetchLogsExplorer, fetchLogsRpc, tronEvents, TETHER_TRON_CONTRACT, type LogApi } from '../src/sources/events.js';

const WANT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WANT_TOPIC0 = '0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc';
const WRONG_ADDRESS = '0xdead000000000000000000000000000000beef';
const WRONG_TOPIC0 = '0xbad0000000000000000000000000000000000000000000000000000000000';

const fakeApi: LogApi = { chain: 'ETH', api: 'https://fake-explorer.example/api', txUrl: (h) => h };

describe('fetchLogsExplorer drops logs for a different contract or topic', () => {
	it('keeps only the log matching the requested address and topic0', async () => {
		const fetchStub = (async () =>
			new Response(
				JSON.stringify({
					status: '1',
					result: [
						{ blockNumber: '0x64', logIndex: '0x0', timeStamp: '0x1', transactionHash: '0xaaa1', address: WANT_ADDRESS, topics: [WANT_TOPIC0], data: '0x' },
						// wrong emitting contract, requested topic0
						{ blockNumber: '0x65', logIndex: '0x0', timeStamp: '0x2', transactionHash: '0xaaa2', address: WRONG_ADDRESS, topics: [WANT_TOPIC0], data: '0x' },
						// requested contract, wrong topic0 (a different event)
						{ blockNumber: '0x66', logIndex: '0x0', timeStamp: '0x3', transactionHash: '0xaaa3', address: WANT_ADDRESS, topics: [WRONG_TOPIC0], data: '0x' },
						// requested contract/topic0, different letter case — still a match
						{ blockNumber: '0x67', logIndex: '0x0', timeStamp: '0x4', transactionHash: '0xaaa4', address: WANT_ADDRESS.toUpperCase().replace('0X', '0x'), topics: [WANT_TOPIC0.toUpperCase().replace('0X', '0x')], data: '0x' }
					]
				})
			)) as typeof fetch;
		const { logs, dropped } = await fetchLogsExplorer(fakeApi, WANT_ADDRESS, WANT_TOPIC0, { fetch: fetchStub });
		expect(logs.map((l) => l.transactionHash)).toEqual(['0xaaa1', '0xaaa4']);
		expect(dropped).toBe(2);
	});
});

describe('fetchLogsRpc drops logs for a different contract or topic', () => {
	it('keeps only the log matching the requested address and topic0', async () => {
		const fetchStub = (async (_url: string | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
			if (body.method === 'eth_blockNumber') return new Response(JSON.stringify({ result: '0x100' }));
			if (body.method === 'eth_getLogs') {
				return new Response(
					JSON.stringify({
						result: [
							{ blockNumber: '0x64', logIndex: '0x0', transactionHash: '0xbbb1', address: WANT_ADDRESS, topics: [WANT_TOPIC0], data: '0x', blockTimestamp: '0x1' },
							{ blockNumber: '0x65', logIndex: '0x0', transactionHash: '0xbbb2', address: WRONG_ADDRESS, topics: [WANT_TOPIC0], data: '0x', blockTimestamp: '0x2' },
							{ blockNumber: '0x66', logIndex: '0x0', transactionHash: '0xbbb3', address: WANT_ADDRESS, topics: [WRONG_TOPIC0], data: '0x', blockTimestamp: '0x3' }
						]
					})
				);
			}
			return new Response('{}');
		}) as typeof fetch;
		const { logs, dropped } = await fetchLogsRpc('https://fake-rpc.example', WANT_ADDRESS, WANT_TOPIC0, { fetch: fetchStub });
		expect(logs.map((l) => l.transactionHash)).toEqual(['0xbbb1']);
		expect(dropped).toBe(2);
	});
});

describe('tronEvents drops events for a different contract or event name', () => {
	it('keeps only the event matching the requested contract and event name', async () => {
		const fetchStub = (async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							transaction_id: 't1',
							event_index: 0,
							result: { _user: 'TUser1111111111111111111111111111' },
							block_timestamp: 1_700_000_000_000,
							block_number: 10,
							event_name: 'AddedBlackList',
							contract_address: TETHER_TRON_CONTRACT
						},
						// wrong event name, requested contract
						{
							transaction_id: 't2',
							event_index: 0,
							result: { _user: 'TUser2222222222222222222222222222' },
							block_timestamp: 1_700_000_000_000,
							block_number: 10,
							event_name: 'SomeOtherEvent',
							contract_address: TETHER_TRON_CONTRACT
						},
						// requested event name, wrong contract
						{
							transaction_id: 't3',
							event_index: 0,
							result: { _user: 'TUser3333333333333333333333333333' },
							block_timestamp: 1_700_000_000_000,
							block_number: 10,
							event_name: 'AddedBlackList',
							contract_address: 'TSomeOtherContractAddress111111111'
						}
					]
				})
			)) as typeof fetch;
		const { events, dropped } = await tronEvents(TETHER_TRON_CONTRACT, 'AddedBlackList', { fetch: fetchStub });
		expect(events.map((e) => e.tx)).toEqual(['t1']);
		expect(dropped).toBe(2);
	});
});
