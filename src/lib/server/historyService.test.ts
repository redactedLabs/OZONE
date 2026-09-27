import { describe, expect, it } from 'vitest';
import { groupTransactions, redactGroups, redactTransactions } from './historyService';
import type { HistoryTransaction } from '$lib/utils/historyTypes';

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
