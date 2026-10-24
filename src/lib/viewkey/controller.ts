/**
 * One view: open the file in the Worker, read the chain from two sources, replay, find the payees of
 * the spends, check every counterparty with Ozone, and build what the page shows.
 *
 * Network: chain reads (`ChainPair`, GET to the two RPC sources) and one or more `POST /api/v1/screen`
 * with addresses. The file text goes only to the Worker (`postMessage`, in this browser).
 */
import type { ChainSource, DeploymentConfig } from './config';
import { CHAIN_SOURCES } from './config';
import type { ActivityTx, FetchFn, ProxyFacts } from './chain';
import { ChainPair, platformFetch } from './chain';
import type { ViewerBridge } from './bridge';
import type { ViewAnswers, ViewModel } from './model';
import { buildModel, counterpartyAddresses } from './model';
import { screenAddresses } from './screen';
import type { Opened } from './protocol';
import type { ViewAccount, ViewEvent, ViewNote, ViewSyncStatus } from '$lib/vendor/vault-sdk/types.js';

export type Step = 'open' | 'chain' | 'payees' | 'screen' | 'done';

/**
 * Depositors and payees are read from the proxy's own events, a bulk read of every transaction that
 * executed the proxy from a little before the account's first activity (a deposit's transaction comes
 * an admission window before its note) to the pinned height. It names the proxy and a height range only.
 */
export const DEPOSIT_MARGIN_BLOCKS = 20_000;

export interface RunOptions {
	bridge: ViewerBridge;
	text: string;
	deployments: DeploymentConfig[];
	sources?: readonly [ChainSource, ChainSource];
	fetchFn?: FetchFn;
	onStep?: (s: Step) => void;
	/** Errata E-66 (4): reach deeper gaps (more work), still cross-checked. */
	deep?: boolean;
}

export async function runView(o: RunOptions): Promise<{ model: ViewModel; answers: ViewAnswers }> {
	const fetchFn = o.fetchFn ?? platformFetch;
	const sources = o.sources ?? CHAIN_SOURCES;
	o.onStep?.('open');
	const opened = await o.bridge.open(o.text, o.deployments);
	const chain = new ChainPair(sources, opened.deployment.chain_id, opened.deployment.proxy, fetchFn);
	o.bridge.env = { height: () => chain.tip(), feedRecords: () => chain.feedRecords(), balances: (a) => chain.balances(a) };

	o.onStep?.('chain');
	const status = await o.bridge.call<ViewSyncStatus>('sync', { deep: o.deep ?? false });
	const [warnings, notes, balances, history, accounts, spendingAccounts, exitAddresses] = await Promise.all([
		o.bridge.call<string[]>('warnings'),
		o.bridge.call<ViewNote[]>('notes'),
		o.bridge.call<Record<string, string>>('balances'),
		o.bridge.call<ViewEvent[]>('history'),
		o.bridge.call<ViewAccount[]>('accounts'),
		o.bridge.call<{ index: number; address: string }[]>('spendingAccounts'),
		o.bridge.call<string[]>('exitAddresses')
	]);
	const addressBalances = await o.bridge.call<ViewAnswers['addressBalances']>('addressBalances');

	o.onStep?.('payees');
	const heights = [
		...history.map((e) => e.height),
		...notes.map((n) => n.status.height ?? null),
		...accounts.map((x) => Number((x.record as { created?: unknown } | null)?.created ?? NaN))
	].filter((h): h is number => typeof h === 'number' && Number.isSafeInteger(h) && h > 0);
	let facts: ProxyFacts | null = null;
	const activity = new Map<string, ActivityTx[] | null>();
	if (heights.length) {
		const from = Math.min(...heights) - DEPOSIT_MARGIN_BLOCKS;
		try {
			facts = await chain.proxyFacts(from);
		} catch {
			facts = null; // shown as "not read"
		}
		for (const s of spendingAccounts) {
			const created = Number((accounts.find((x) => x.address === s.address)?.record as { created?: unknown } | null)?.created ?? NaN);
			try {
				activity.set(s.address, await chain.activity(s.address, Number.isSafeInteger(created) ? created : from));
			} catch {
				activity.set(s.address, null);
			}
		}
	}

	const answers: ViewAnswers = {
		opened: opened as Opened,
		status,
		warnings,
		notes,
		balances,
		history,
		accounts,
		spendingAccounts,
		exitAddresses,
		addressBalances,
		facts,
		activity,
		sourceNames: sources.map((s) => s.name)
	};

	o.onStep?.('screen');
	const screen = await screenAddresses(counterpartyAddresses(answers), fetchFn);
	o.onStep?.('done');
	return { model: buildModel(answers, screen), answers };
}
