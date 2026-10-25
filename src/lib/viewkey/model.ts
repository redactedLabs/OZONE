/**
 * What the page shows, built from the view session's answers (errata E-66 (4), (5)) and Ozone's
 * verdicts. The viewer's own warnings are always shown in full; the banners above them say the same
 * things in short: the file is not authenticated and its balances are no proof of funds, what the
 * chain confirms, and what is only the file's claim.
 */
import type { Ownership, ViewAccount, ViewEvent, ViewNote, ViewSyncStatus, Coin } from '$lib/vendor/vault-sdk/types.js';
import type { ActivityTx, ProxyFacts, SpendEvent } from './chain';
import type { Role, ScreenResult, Verdict } from './screen';
import { activeReasons, addCounterparty } from './screen';
import type { Opened } from './protocol';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export interface Label {
	text: string;
	tone: Tone;
}
export interface Banner {
	tone: Tone;
	title: string;
	text: string;
}
export interface Party {
	address: string;
	role: Role;
}
export interface HistoryRow {
	key: string;
	height: number | null;
	title: string;
	amount: string | null;
	parties: Party[];
	labels: Label[];
}
export interface NoteRow {
	key: string;
	index: number | null;
	cm: string;
	amount: string;
	generation: number;
	origin: string;
	status: string;
	labels: Label[];
}
export interface AccountRow {
	index: number | null;
	address: string;
	labels: Label[];
	returns: number;
	returned: string[];
	balances: string[];
	/** Transactions that executed it; null when not read. */
	transactions: number | null;
}
export interface ExitRow {
	address: string;
	labels: Label[];
	balances: string[];
}
export interface CounterpartyRow {
	address: string;
	roles: Role[];
	verdict: Verdict | null;
	label: Label;
	reasons: { text: string; source: string; risk: string; ref?: string }[];
}
export interface ViewModel {
	kind: 'view_key';
	banners: Banner[];
	warnings: string[];
	summary: { fingerprint: string; chain: string; proxy: string; height: number; sources: number; sourceNames: string[]; generations: number[]; nk: string };
	balances: { denom: string; amount: string }[];
	history: HistoryRow[];
	notes: NoteRow[];
	accounts: AccountRow[];
	exits: ExitRow[];
	counterparties: CounterpartyRow[];
	screening: { snapshot: ScreenResult['snapshot']; error: string | null; signed: boolean };
}

export interface ViewAnswers {
	opened: Opened;
	status: ViewSyncStatus;
	warnings: string[];
	notes: ViewNote[];
	balances: Record<string, string>;
	history: ViewEvent[];
	accounts: ViewAccount[];
	spendingAccounts: { index: number; address: string }[];
	exitAddresses: string[];
	addressBalances: { address: string; kind: 'spending' | 'exit'; owner: Ownership | 'claimed_by_file'; balances: Coin[] }[];
	/** Depositors and payees from the proxy's events (both sources); null when not read. */
	facts: ProxyFacts | null;
	/** Each listed Spending account's transactions (both sources); null when not read. */
	activity: Map<string, ActivityTx[] | null>;
	sourceNames: string[];
}

export const ROLE_TEXT: Record<Role, string> = {
	depositor: 'Depositor',
	payee: 'Payee',
	slow_recipient: 'Slow payee',
	queued_recipient: 'Queued payee',
	spending_account: 'Spending account',
	returning_account: 'Returned from',
	exit_address: 'Exit address',
	spending_payee: 'Paid from Spending',
	called_contract: 'Called from Spending',
	gift_account: 'Gift from'
};

/** Amounts on THORChain carry 8 decimals for every denomination. */
export function formatAmount(amount: string, denom: string): string {
	if (!/^[0-9]+$/.test(amount)) return `${amount} ${denom.toUpperCase()}`;
	const s = amount.padStart(9, '0');
	const whole = s.slice(0, -8).replace(/^0+(?=\d)/, '');
	const frac = s.slice(-8).replace(/0+$/, '');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${grouped}${frac ? '.' + frac : ''} ${denom.toUpperCase()}`;
}

const OWNER_LABEL: Record<string, Label> = {
	established: { text: 'Established', tone: 'ok' },
	not_established: { text: 'Not established', tone: 'warn' },
	not_on_chain: { text: 'Not on chain', tone: 'muted' },
	claimed_by_file: { text: "File's claim", tone: 'warn' }
};

const STATUS_LABEL: Record<string, Label | null> = {
	pending: { text: 'Pending admission', tone: 'muted' },
	refunded: { text: 'Refunded', tone: 'muted' },
	admitted: null
};

const NOT_NAMED: Label = { text: 'Generation not named · not counted', tone: 'bad' };

/** The spend or exit event of the proxy that consumed one of `nfs`. */
function eventFor(events: SpendEvent[] | undefined, nfs: string[]): SpendEvent | null {
	if (!events || !nfs.length) return null;
	return events.find((e) => e.nullifiers.some((n) => nfs.includes(n))) ?? null;
}

/** `100000000rune,5btc-btc` (a bank event's amount) as display amounts. */
export function formatCoins(coins: string): string {
	return coins
		.split(',')
		.map((c) => /^([0-9]+)([a-zA-Z][a-zA-Z0-9/:._-]*)$/.exec(c.trim()))
		.filter((m): m is RegExpExecArray => !!m)
		.map((m) => formatAmount(m[1]!, m[2]!))
		.join(' + ');
}

const SPEND_TITLE: Record<string, string> = { fast1: 'Spend', fast2: 'Spend', slow1: 'Slow withdrawal', exit: 'Exit', queue_audit: 'Audit release' };
const EVENT_TITLE: Record<string, string> = { withdraw: 'Withdrawal', fund: 'Funding to Spending', merge: 'Merge' };

export function buildModel(a: ViewAnswers, screen: ScreenResult): ViewModel {
	const byIndex = new Map<number, ViewNote>();
	for (const n of a.notes) if (n.index !== null) byIndex.set(n.index, n);
	const parties = new Map<string, Set<Role>>();
	const history: HistoryRow[] = [];

	a.history.forEach((e, i) => {
		const key = `${e.event}-${i}`;
		if (e.event === 'deposit') {
			const labels: Label[] = [];
			const st = STATUS_LABEL[e.status];
			if (st) labels.push(st);
			if (!e.generation_named) labels.push(NOT_NAMED);
			// an admitted deposit is a note in the feeds; its sender is in the proxy's `hops_deposit` event
			const cm = e.index !== null ? byIndex.get(e.index)?.cm : undefined;
			const source = e.source ?? (cm ? a.facts?.deposits.find((d) => d.cm === cm)?.source : undefined) ?? null;
			if (!source) labels.push({ text: 'Depositor not read', tone: 'muted' });
			addCounterparty(parties, source, 'depositor');
			history.push({ key, height: e.height, title: 'Deposit', amount: formatAmount(e.amount, e.denom), parties: source ? [{ address: source, role: 'depositor' }] : [], labels });
		} else if (e.event === 'return') {
			const labels: Label[] = [OWNER_LABEL[e.account_owner] ?? { text: e.account_owner, tone: 'muted' }];
			if (e.own_funds === true) labels.push({ text: 'Own money', tone: 'muted' });
			if (e.own_funds === false) labels.push({ text: 'Third-party money', tone: 'muted' });
			const st = STATUS_LABEL[e.status];
			if (st) labels.push(st);
			addCounterparty(parties, e.account, 'returning_account');
			history.push({ key, height: e.height, title: 'Return from Spending', amount: formatAmount(e.amount, e.denom), parties: e.account ? [{ address: e.account, role: 'returning_account' }] : [], labels });
		} else if (e.event === 'spend') {
			const nfs = e.inputs.map((x) => byIndex.get(x)?.nf).filter((x): x is string => !!x);
			const ev = eventFor(a.facts?.spends, nfs);
			const labels: Label[] = [];
			let title = SPEND_TITLE[e.kind] ?? 'Spend';
			const ps: Party[] = [];
			if (ev?.type === 'spend') {
				title = e.kind === 'slow1' ? 'Slow withdrawal' : EVENT_TITLE[ev.kind] ?? title;
				if (ev.recipient) {
					const role: Role = ev.kind === 'fund' ? 'spending_account' : e.kind === 'slow1' ? 'slow_recipient' : 'payee';
					ps.push({ address: ev.recipient, role });
					addCounterparty(parties, ev.recipient, role);
				}
			} else if (ev?.type === 'exit') {
				title = `Exit to ${ev.kind}`;
				if (ev.recipient) {
					ps.push({ address: ev.recipient, role: 'payee' });
					addCounterparty(parties, ev.recipient, 'payee');
				}
			} else if (e.kind !== 'exit') {
				labels.push({ text: 'Payee not read', tone: 'muted' });
			}
			if (e.kind === 'exit' || e.kind === 'queue_audit') labels.push({ text: 'Opening published', tone: 'warn' });
			if (e.change !== null) labels.push({ text: 'Change kept', tone: 'muted' });
			history.push({ key, height: e.height, title, amount: e.amount === '0' && !ev?.amount ? null : formatAmount(ev?.amount ?? e.amount, e.denom), parties: ps, labels });
		} else if (e.event === 'slow_request') {
			const r = (e.record ?? {}) as { recipient?: string; amount?: string; denom?: string; release?: number };
			addCounterparty(parties, r.recipient, 'slow_recipient');
			const labels: Label[] = r.release ? [{ text: `Release at ${r.release}`, tone: 'muted' }] : [];
			history.push({ key, height: e.height, title: 'Slow request', amount: r.amount && r.denom ? formatAmount(r.amount, r.denom) : null, parties: r.recipient ? [{ address: r.recipient, role: 'slow_recipient' }] : [], labels });
		} else if (e.event === 'queued') {
			const it = e.item;
			addCounterparty(parties, it.recipient, 'queued_recipient');
			const labels: Label[] = [{ text: `Paid ${formatAmount(it.paid, it.denom)}`, tone: 'muted' }];
			if (it.audit_only) labels.push({ text: 'Audit only', tone: 'warn' });
			history.push({ key, height: e.height, title: 'Queued payout', amount: formatAmount(it.amount, it.denom), parties: [{ address: it.recipient, role: 'queued_recipient' }], labels });
		}
	});
	for (const [account, txs] of a.activity) {
		for (const t of txs ?? []) {
			const ps: Party[] = [];
			for (const x of t.sent) {
				ps.push({ address: x.recipient, role: 'spending_payee' });
				addCounterparty(parties, x.recipient, 'spending_payee');
			}
			for (const c of t.called) {
				ps.push({ address: c, role: 'called_contract' });
				addCounterparty(parties, c, 'called_contract');
			}
			const sent = t.sent.map((x) => formatCoins(x.amount)).filter(Boolean).join(' + ');
			history.push({ key: `activity-${account}-${t.hash}`, height: t.height, title: 'Spending account', amount: sent || null, parties: ps, labels: [{ text: `Account ${account.slice(0, 9)}…${account.slice(-4)}`, tone: 'muted' }] });
		}
	}
	// oldest first, then newest first for the page (a stable sort keeps the order within a block)
	history.sort((x, y) => (x.height ?? Number.MAX_SAFE_INTEGER) - (y.height ?? Number.MAX_SAFE_INTEGER));
	history.reverse();

	const notes: NoteRow[] = a.notes.map((n, i) => {
		const labels: Label[] = [];
		if (!n.generation_named) labels.push(NOT_NAMED);
		const origin = n.origin.kind === 'deposit' ? 'Deposit' : n.origin.kind === 'slot' ? `Return · account ${n.origin.account_index}` : 'Change';
		const st = n.status.state === 'spent' ? `Spent${n.status.height ? ' at ' + n.status.height : ''}` : n.status.state === 'unspent' ? 'Unspent' : n.status.state === 'pending' ? 'Pending' : 'Refunded';
		if (n.slow_request) labels.push({ text: 'Slow request', tone: 'muted' });
		return { key: `${n.cm}-${i}`, index: n.index, cm: n.cm, amount: formatAmount(n.amount, n.denom), generation: n.generation, origin, status: st, labels };
	});

	const balanceOf = (addr: string) => a.addressBalances.find((b) => b.address === addr)?.balances.filter((c) => c.amount !== '0').map((c) => formatAmount(c.amount, c.denom)) ?? [];
	const accounts: AccountRow[] = [];
	for (const s of a.spendingAccounts) {
		const acc = a.accounts.find((x) => x.address === s.address);
		const owner = acc?.owner ?? a.addressBalances.find((b) => b.address === s.address)?.owner ?? 'not_established';
		const labels: Label[] = [OWNER_LABEL[owner] ?? { text: String(owner), tone: 'muted' }, { text: 'Listed by the file', tone: 'muted' }];
		addCounterparty(parties, s.address, 'spending_account');
		accounts.push({
			index: s.index,
			address: s.address,
			labels,
			returns: acc?.returns.length ?? 0,
			returned: (acc?.returns ?? []).map((n) => formatAmount(n.amount, n.denom)),
			balances: balanceOf(s.address),
			transactions: a.activity.has(s.address) ? (a.activity.get(s.address)?.length ?? null) : null
		});
	}
	const exits: ExitRow[] = a.exitAddresses.map((address) => {
		addCounterparty(parties, address, 'exit_address');
		return { address, labels: [OWNER_LABEL.claimed_by_file!], balances: balanceOf(address) };
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

	// banners: the file is not authenticated, what the chain confirms, and what is only the file's claim
	const banners: Banner[] = [
		{
			tone: 'bad',
			title: 'Not a proof of funds',
			text: 'This file is not authenticated: anyone can write one, and holding it proves no ownership. What you see is the chain’s data under the file’s values.'
		}
	];
	if (a.status.nk_check === 'contradicted') banners.push({ tone: 'bad', title: 'Contradicted by the chain', text: 'The chain contradicts this file’s nullifier key: the file is damaged or forged, and its balances prove nothing.' });
	else if (a.status.nk_check === 'unverified') banners.push({ tone: 'warn', title: 'Not confirmed by the chain', text: 'No note it shows has been spent yet, so the chain cannot confirm the file’s keys. A file with another key would show spent notes as unspent.' });
	else if (a.status.nk_check === 'verified') banners.push({ tone: 'ok', title: 'Keys confirmed by the chain', text: 'A spend of a note this file shows carries the nullifier its key computes.' });
	const unnamed = a.notes.filter((n) => !n.generation_named).length;
	if (unnamed) banners.push({ tone: 'warn', title: 'Notes outside the file’s generations', text: `${unnamed} note${unnamed > 1 ? 's' : ''} under generation numbers the file does not name. Anyone holding this view key can put notes there: shown apart, never counted.` });
	const notEstablished = accounts.filter((x) => x.labels[0]?.text !== 'Established').length + a.history.filter((e) => e.event === 'return' && e.account_owner !== 'established').length;
	if (notEstablished) banners.push({ tone: 'warn', title: 'Accounts not established', text: 'Some Spending accounts do not carry this key’s slot tree on chain. Their activity is not shown as the account’s.' });
	if (exits.length) banners.push({ tone: 'warn', title: 'Exit addresses are the file’s claim', text: 'Nothing public ties them to the account.' });
	if (a.history.some((e) => e.event === 'spend' && (e.kind === 'exit' || e.kind === 'queue_audit'))) {
		banners.push({ tone: 'warn', title: 'Owner opening published', text: 'An exit or audit release made this account’s opening public. A view-key holder can then move its notes to the owner’s own wallets in the Bunker modes.' });
	}
	if (a.status.sources >= 2) banners.push({ tone: 'ok', title: 'Two sources agree', text: `Read at block ${a.status.height} from ${a.sourceNames.join(' and ')}, cross-checked.` });
	else banners.push({ tone: 'warn', title: 'One source', text: 'This sync read one source only: a spend could be hidden.' });

	return {
		kind: 'view_key',
		banners,
		warnings: a.warnings,
		summary: {
			fingerprint: a.opened.fingerprint,
			chain: a.opened.deployment.chain_id,
			proxy: a.opened.deployment.proxy,
			height: a.status.height,
			sources: a.status.sources,
			sourceNames: a.sourceNames,
			generations: a.opened.generations,
			nk: a.status.nk_check ?? 'unverified'
		},
		balances: Object.entries(a.balances).map(([denom, amount]) => ({ denom, amount: formatAmount(amount, denom) })),
		history,
		notes,
		accounts,
		exits,
		counterparties,
		screening: { snapshot: screen.snapshot, error: screen.error, signed: screen.signed }
	};
}

/** The counterparty addresses of a view (for screening), before the verdicts. */
export function counterpartyAddresses(a: ViewAnswers): string[] {
	return buildModel(a, { verdicts: new Map(), snapshot: null, error: null, signed: false }).counterparties.map((c) => c.address);
}
