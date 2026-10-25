/**
 * What the page shows for the viewer's labels: notes under generations the file does not name, accounts
 * the chain does not establish, a contradicted or unconfirmed key, one source, a published opening.
 */
import { describe, expect, it } from 'vitest';
import { buildModel, formatAmount, formatCoins, type ViewAnswers } from './model';
import { fixture } from './__fixtures__/fake-chain';
import type { ViewEvent, ViewNote } from '$lib/vendor/vault-sdk/types.js';

const NONE = { verdicts: new Map(), snapshot: null, error: null, signed: false };

function answers(over: Partial<ViewAnswers> = {}): ViewAnswers {
	const e = fixture.expect;
	return {
		opened: { kind: 'view_key', fingerprint: fixture.fingerprint, generations: [0], deployment: { chain_id: fixture.deployment.chain_id, proxy: fixture.deployment.proxy, id: fixture.deployment_id } },
		status: e.status as ViewAnswers['status'],
		warnings: e.warnings,
		notes: structuredClone(e.notes) as ViewNote[],
		balances: e.balances,
		history: structuredClone(e.history) as ViewEvent[],
		accounts: e.accounts as ViewAnswers['accounts'],
		spendingAccounts: e.spendingAccounts,
		exitAddresses: e.exitAddresses,
		addressBalances: [],
		facts: null,
		activity: new Map(),
		sourceNames: ['A', 'B'],
		...over
	};
}

describe('view model', () => {
	it('always opens with "Not a proof of funds", and lists the viewer warnings in full', () => {
		const m = buildModel(answers(), NONE);
		expect(m.banners[0]).toEqual(expect.objectContaining({ tone: 'bad', title: 'Not a proof of funds' }));
		expect(m.warnings).toEqual(fixture.expect.warnings);
	});

	it('marks notes and deposits under a generation the file does not name, never counted', () => {
		const a = answers();
		a.notes[0]!.generation_named = false;
		(a.history[0] as Extract<ViewEvent, { event: 'deposit' }>).generation_named = false;
		const m = buildModel(a, NONE);
		expect(m.banners.map((b) => b.title)).toContain('Notes outside the file’s generations');
		expect(m.notes[0]!.labels).toContainEqual({ text: 'Generation not named · not counted', tone: 'bad' });
		expect(m.history.at(-1)!.labels).toContainEqual({ text: 'Generation not named · not counted', tone: 'bad' });
	});

	it('marks returns from accounts the chain does not establish', () => {
		const a = answers();
		const r = a.history.find((e) => e.event === 'return') as Extract<ViewEvent, { event: 'return' }>;
		r.account_owner = 'not_established';
		const m = buildModel(a, NONE);
		expect(m.banners.map((b) => b.title)).toContain('Accounts not established');
		expect(m.history.find((h) => h.title === 'Return from Spending')!.labels[0]).toEqual({ text: 'Not established', tone: 'warn' });
	});

	it('says what the chain says of the key: contradicted, unconfirmed, confirmed', () => {
		const t = (nk: 'verified' | 'unverified' | 'contradicted') => buildModel(answers({ status: { ...fixture.expect.status, nk_check: nk } as ViewAnswers['status'] }), NONE).banners;
		expect(t('contradicted')[1]).toEqual(expect.objectContaining({ tone: 'bad', title: 'Contradicted by the chain' }));
		expect(t('unverified')[1]).toEqual(expect.objectContaining({ tone: 'warn', title: 'Not confirmed by the chain' }));
		expect(t('verified')[1]).toEqual(expect.objectContaining({ tone: 'ok', title: 'Keys confirmed by the chain' }));
	});

	it('warns on one source and on a published owner opening', () => {
		const a = answers({ status: { ...fixture.expect.status, sources: 1 } as ViewAnswers['status'] });
		a.history.push({ event: 'spend', height: 2000, kind: 'exit', inputs: [], denom: 'rune', amount: '1', change: null });
		const titles = buildModel(a, NONE).banners.map((b) => b.title);
		expect(titles).toContain('One source');
		expect(titles).toContain('Owner opening published');
	});

	it('formats THORChain amounts (8 decimals) and bank coins', () => {
		expect(formatAmount('4000000000', 'rune')).toBe('40 RUNE');
		expect(formatAmount('123456789012', 'btc-btc')).toBe('1,234.56789012 BTC-BTC');
		expect(formatAmount('1', 'rune')).toBe('0.00000001 RUNE');
		expect(formatCoins('100000000rune,5btc-btc')).toBe('1 RUNE + 0.00000005 BTC-BTC');
	});
});
