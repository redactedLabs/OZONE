/**
 * What the page shows for a history file (errata E-68): the viewer's warnings first (not authenticated,
 * not a proof of funds, completeness rests on the owner, the cut, held notes checked or not, what is only
 * the file's statement), then each listed note with its verdict, the totals at the cut over the verified
 * notes, and every address the file names (and the depositors the proxy's events name, up to the cut) with
 * its roles and Ozone's verdict. Nothing after the cut is shown: the viewer reads nothing above it, and the
 * proxy events the page reads are cut at it too.
 */
import type { HistoryAccount, HistoryItem, HistoryStatus, HistoryTotals } from '$lib/vendor/vault-sdk/types.js';
import type { ProxyFacts } from './chain';
import type { Banner, CounterpartyRow, Label, Party } from './model';
import { formatAmount } from './model';
import type { Opened } from './protocol';
import type { Role, ScreenResult } from './screen';
import { activeReasons, addCounterparty } from './screen';

export interface HistoryAnswers {
	opened: Opened;
	status: HistoryStatus;
	items: HistoryItem[];
	totals: HistoryTotals;
	accounts: HistoryAccount[];
	warnings: string[];
	/** Depositors and payees from the proxy's events (both sources), read below the tip and cut here at the cut. */
	facts: ProxyFacts | null;
	sourceNames: string[];
	/** Whether this browser keeps the file's window seed (else repeat checks may reveal the cut). */
	seedKept: boolean;
}

export interface HistoryItemRow {
	key: string;
	index: number;
	title: string;
	amount: string;
	height: number;
	fate: string;
	verdict: Label;
	labels: Label[];
	parties: Party[];
	reasons: string[];
}

export interface HistoryModel {
	kind: 'history';
	banners: Banner[];
	/** One line when the seed is not kept (repeat checks may reveal the cut to node operators). */
	seedNote: string | null;
	warnings: string[];
	summary: { fingerprint: string; chain: string; proxy: string; cut: number; blockHash: string; sources: number; blockSources: number; heights: number[]; heldNullifiers: boolean; verified: boolean; failed: number; stated: number; counted: number; items: number; sourceNames: string[] };
	totals: { denom: string; held: string; heldConfirmed: string | null; deposited: string; returned: string; gifts: string; left: string }[];
	items: HistoryItemRow[];
	accounts: { address: string; kind: 'spending' | 'exit'; label: Label }[];
	counterparties: CounterpartyRow[];
	screening: { snapshot: ScreenResult['snapshot']; error: string | null; signed: boolean };
}

export const SEED_NOT_KEPT = 'This browser keeps no data for this page: checking this file again may reveal its cut to node operators.';

const VERDICT: Record<HistoryItem['verdict'], Label> = {
	verified: { text: 'Verified', tone: 'ok' },
	stated: { text: 'Stated by the file', tone: 'warn' },
	failed: { text: 'Failed', tone: 'bad' },
	not_checked: { text: 'Not checked', tone: 'muted' }
};
const ARRIVAL: Record<HistoryItem['arrived']['kind'], string> = { deposit: 'Deposit', return: 'Return from Spending', gift: 'Gift', change: 'Change' };
const BY: Record<string, string> = { fast1: 'a FAST spend', fast2: 'a FAST spend of two notes', slow1: 'a SLOW request', exit: 'an exit' };
const EVENT_KIND: Record<string, string> = { withdraw: 'withdrawal', fund: 'funding to Spending', merge: 'merge' };
const ACCOUNT_CHECK: Record<HistoryAccount['check'], Label> = {
	on_chain_at_cut: { text: 'On chain at the cut', tone: 'ok' },
	not_on_chain_at_cut: { text: 'Not on chain at the cut', tone: 'bad' },
	stated_by_file: { text: "File's claim", tone: 'warn' },
	not_checked: { text: 'Not checked', tone: 'muted' }
};

export function buildHistoryModel(a: HistoryAnswers, screen: ScreenResult): HistoryModel {
	const cut = a.status.cut.height;
	const parties = new Map<string, Set<Role>>();
	// the proxy's events, cut at the cut (the page reads them below the tip and never shows one above the cut)
	const deposits = (a.facts?.deposits ?? []).filter((d) => d.height <= cut);
	const spends = (a.facts?.spends ?? []).filter((s) => s.height <= cut);

	const items: HistoryItemRow[] = a.items.map((it) => {
		const labels: Label[] = [];
		const ps: Party[] = [];
		const arr = it.arrived;
		if (arr.kind === 'deposit') {
			const source = deposits.find((d) => d.cm === it.cm)?.source;
			if (source) {
				ps.push({ address: source, role: 'depositor' });
				addCounterparty(parties, source, 'depositor');
			} else labels.push({ text: 'Depositor not read', tone: 'muted' });
		} else if (arr.kind === 'return') {
			ps.push({ address: arr.account, role: 'returning_account' });
			addCounterparty(parties, arr.account, 'returning_account');
		} else if (arr.kind === 'gift') {
			labels.push({ text: "Not the owner's account", tone: 'warn' });
			ps.push({ address: arr.account, role: 'gift_account' });
			addCounterparty(parties, arr.account, 'gift_account');
		}
		let fate: string;
		const f = it.fate;
		if (f.kind === 'held') {
			fate = 'Held at the cut';
			if (it.held_check === 'nullifier_unspent') labels.push({ text: 'Unspent at the cut', tone: 'ok' });
			else if (it.held_check === 'nullifier_spent') labels.push({ text: 'Spent before the cut', tone: 'bad' });
			else labels.push({ text: 'Held: not checked', tone: 'muted' });
		} else {
			// what the spend was, from the proxy's own event when it was read (a funding names a Spending account)
			const ev = spends.find((s) => s.nullifiers.includes(f.nf));
			const what = ev?.type === 'spend' && EVENT_KIND[ev.kind] ? EVENT_KIND[ev.kind] : ev?.type === 'exit' ? `exit to ${ev.kind}` : (BY[f.by] ?? f.by);
			fate = `Spent at #${f.height.toLocaleString('en-US')}: ${what}`;
			const role: Role = ev?.type === 'spend' && ev.kind === 'fund' ? 'spending_account' : 'payee';
			if (f.payee) {
				ps.push({ address: f.payee, role });
				addCounterparty(parties, f.payee, role);
				labels.push({ text: 'Payee stated by the file', tone: 'muted' });
			}
			if (ev?.recipient) {
				if (ev.recipient === f.payee) labels.push({ text: 'Payee in the spend event', tone: 'ok' });
				else {
					labels.push({ text: 'The spend event paid another address', tone: 'warn' });
					ps.push({ address: ev.recipient, role });
					addCounterparty(parties, ev.recipient, role);
				}
			}
			if (it.spend_check === 'stated') labels.push({ text: 'Exit not tied to this note', tone: 'warn' });
		}
		return {
			key: `${it.index}-${it.cm}`,
			index: it.index,
			title: ARRIVAL[arr.kind],
			amount: formatAmount(it.amount, it.denom),
			height: it.height,
			fate,
			verdict: VERDICT[it.verdict] ?? { text: it.verdict, tone: 'muted' },
			labels,
			parties: ps,
			reasons: it.reasons ?? []
		};
	});

	const accounts = a.accounts.map((x) => {
		addCounterparty(parties, x.address, x.kind === 'spending' ? 'spending_account' : 'exit_address');
		return { address: x.address, kind: x.kind, label: ACCOUNT_CHECK[x.check] ?? { text: x.check, tone: 'muted' as const } };
	});

	const counterparties: CounterpartyRow[] = [...parties.entries()].map(([address, roles]) => {
		const v = screen.verdicts.get(address) ?? null;
		const label: Label = !v
			? { text: screen.error ? 'Not checked' : 'No answer', tone: 'muted' }
			: v.status === 'flagged'
				? { text: `Flagged · ${v.risk}`, tone: 'bad' }
				: v.status === 'invalid'
					? { text: 'Not screenable', tone: 'muted' }
					: activeReasons(v).length
						? { text: `Listed · ${v.risk}`, tone: 'warn' }
						: { text: 'Clear', tone: 'ok' };
		return { address, roles: [...roles], verdict: v, label, reasons: activeReasons(v ?? undefined).map((r) => ({ text: r.text, source: r.source, risk: r.risk, ref: r.ref })) };
	});
	const rank = (r: CounterpartyRow) => (r.label.tone === 'bad' ? 0 : r.label.tone === 'warn' ? 1 : r.label.tone === 'muted' ? 2 : 3);
	counterparties.sort((x, y) => rank(x) - rank(y));

	const t = a.totals;
	const denoms = [...new Set([t.held, t.held_nullifier_unspent, t.deposited, t.returned, t.gifts, t.left].flatMap((m) => Object.keys(m ?? {})))].sort();
	const fmt = (m: Record<string, string> | undefined, d: string) => formatAmount(m?.[d] ?? '0', d);
	const totals = denoms.map((d) => ({
		denom: d,
		held: fmt(t.held, d),
		heldConfirmed: a.opened.held_nullifiers ? fmt(t.held_nullifier_unspent, d) : null,
		deposited: fmt(t.deposited, d),
		returned: fmt(t.returned, d),
		gifts: fmt(t.gifts, d),
		left: fmt(t.left, d)
	}));

	const s = a.status;
	const banners: Banner[] = [
		{ tone: 'bad', title: 'Not a proof of funds', text: 'This file is not authenticated: anyone who knows these openings can write one. It shows that the chain holds these notes and spends up to the cut, not who owns them.' },
		{ tone: 'warn', title: 'Completeness rests on the owner', text: 'The file proves what it lists, never that nothing is missing.' },
		{ tone: 'muted', title: `Cut at block ${cut.toLocaleString('en-US')}`, text: 'Nothing after this block is read or shown.' },
		a.opened.held_nullifiers
			? { tone: 'warn', title: 'Held notes checked, their next move visible', text: 'The file names their nullifiers: the chain confirms them unspent at the cut, and anyone holding this file sees each one’s next spend.' }
			: { tone: 'warn', title: 'Held notes not checked', text: 'The file leaves their nullifiers out: “held at the cut” is the owner’s statement.' },
		{ tone: 'warn', title: 'Payees and exit addresses are the file’s statement', text: 'A payee is the destination the owner authorized; nothing public ties an exit address to the account.' }
	];
	if (s.stated) banners.push({ tone: 'warn', title: `${s.stated} item${s.stated > 1 ? 's' : ''} stated, not verified`, text: 'An exit no published opening ties to its note: shown, counted nowhere.' });
	if (s.failed) banners.push({ tone: 'bad', title: `${s.failed} item${s.failed > 1 ? 's' : ''} failed`, text: 'The chain does not hold what the file says for these notes.' });
	else if (s.verified) banners.push({ tone: 'ok', title: 'Every listed note checked at the cut', text: `${a.items.length} note${a.items.length === 1 ? '' : 's'}, each found on chain as the file lists it.` });
	if (s.sources >= 2 && s.block_sources >= 2) banners.push({ tone: 'ok', title: 'Two sources agree at the cut', text: `The notes and the block at the cut read from ${a.sourceNames.join(' and ')}, cross-checked.` });
	else banners.push({ tone: 'warn', title: 'One source', text: 'Part of this check read one source only.' });

	return {
		kind: 'history',
		banners,
		seedNote: a.seedKept ? null : SEED_NOT_KEPT,
		warnings: a.warnings,
		summary: {
			fingerprint: a.opened.fingerprint,
			chain: a.opened.deployment.chain_id,
			proxy: a.opened.deployment.proxy,
			cut,
			blockHash: s.cut.block_hash,
			sources: s.sources,
			blockSources: s.block_sources,
			heights: s.snapshot_heights,
			heldNullifiers: s.held_nullifiers,
			verified: s.verified,
			failed: s.failed,
			stated: s.stated,
			counted: t.counted,
			items: a.items.length,
			sourceNames: a.sourceNames
		},
		totals,
		items,
		accounts,
		counterparties,
		screening: { snapshot: screen.snapshot, error: screen.error, signed: screen.signed }
	};
}

/** The addresses to screen (before the verdicts). */
export function historyCounterparties(a: HistoryAnswers): string[] {
	return buildHistoryModel(a, { verdicts: new Map(), snapshot: null, error: null, signed: false }).counterparties.map((c) => c.address);
}
