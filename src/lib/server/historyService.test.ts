import { afterEach, describe, expect, it } from 'vitest';
import { fetchBalances, fetchMidgardActions, groupTransactions, isValidThorAddress, redactGroups, redactTransactions } from './historyService';
import type { HistoryTransaction } from '$lib/utils/historyTypes';

const REAL_THOR_ADDRESS = 'thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';

const tx = (over: Partial<HistoryTransaction> = {}): HistoryTransaction => ({
	type: 'send',
	date: '2026-01-01T00:00:00Z',
	assetIn: 'THOR.RUNE',
	assetOut: 'THOR.RUNE',
	amountIn: '1',
	amountOut: '1',
	rawAmountIn: '100000000',
	rawAmountOut: '100000000',
	from: 'thor1owner000000000000000000000000000000',
	to: 'thor1counterparty0000000000000000000000',
	fromLabel: '',
	toLabel: '',
	txID: 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345678',
	status: 'success',
	...over
});

describe('redactTransactions', () => {
	it('leaves transactions untouched when revealWallet is true', () => {
		const txs = [tx()];
		expect(redactTransactions(txs, true)).toEqual(txs);
	});

	it('blanks from/to/txID on every transaction when revealWallet is false', () => {
		const txs = [tx(), tx({ from: 'thor1owner000000000000000000000000000000', to: 'thor1other0000000000000000000000000000000', txID: 'DIFFERENTTXID' })];
		const out = redactTransactions(txs, false);
		expect(out).toHaveLength(2);
		for (const t of out) {
			expect(t.from).toBe('');
			expect(t.to).toBe('');
			expect(t.txID).toBe('');
		}
		// nothing else about the transaction changes
		expect(out[0].type).toBe('send');
		expect(out[0].assetIn).toBe('THOR.RUNE');
	});
});

describe('redactGroups', () => {
	it('leaves groups untouched when revealWallet is true', () => {
		const groups = groupTransactions([tx()], 'thor1owner000000000000000000000000000000');
		expect(redactGroups(groups, true)).toEqual(groups);
	});

	it('blanks from/to/txID on the group itself, its primary, and every sub-action', () => {
		const a = tx({ txID: 'TX-A', type: 'swap' });
		const b = tx({ txID: 'TX-A', type: 'send', from: 'thor1owner000000000000000000000000000000', to: 'thor1module00000000000000000000000000000' }); // same txID: becomes a sub-action
		const groups = groupTransactions([a, b], 'thor1owner000000000000000000000000000000');
		expect(groups.length).toBeGreaterThan(0);

		const out = redactGroups(groups, false);
		for (const g of out) {
			expect(g.txID).toBe('');
			expect(g.primary.from).toBe('');
			expect(g.primary.to).toBe('');
			expect(g.primary.txID).toBe('');
			for (const sub of g.subActions) {
				expect(sub.from).toBe('');
				expect(sub.to).toBe('');
				expect(sub.txID).toBe('');
			}
		}
		// the real txid must not survive anywhere in the redacted structure,
		// including as the group's own key — a recipient could otherwise look
		// it up directly on a block explorer regardless of what the UI shows
		expect(JSON.stringify(out)).not.toContain('TX-A');
	});
});

describe('isValidThorAddress', () => {
	it('accepts a real, checksum-valid thor1… address', () => {
		expect(isValidThorAddress(REAL_THOR_ADDRESS)).toBe(true);
	});

	it('rejects a merely thor-prefixed string, other chains, and non-strings', () => {
		expect(isValidThorAddress('thor1not-real-bech32')).toBe(false);
		expect(isValidThorAddress('0x098b716b8aaf21512996dc57eb0615e2383e2f96')).toBe(false);
		expect(isValidThorAddress('')).toBe(false);
		expect(isValidThorAddress(undefined as unknown as string)).toBe(false);
		expect(isValidThorAddress(123 as unknown as string)).toBe(false);
	});
});

describe('fetchMidgardActions / fetchBalances: address validated before any fetch', () => {
	const originalFetch = global.fetch;
	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('never calls fetch for a non-thor address', async () => {
		let called = false;
		global.fetch = (async () => {
			called = true;
			throw new Error('fetch must not be called for an invalid address');
		}) as typeof fetch;

		expect(await fetchMidgardActions('not-a-thor-address')).toEqual([]);
		expect(called).toBe(false);
		expect(await fetchBalances('0x098b716b8aaf21512996dc57eb0615e2383e2f96')).toEqual([]);
		expect(called).toBe(false);
	});
});
