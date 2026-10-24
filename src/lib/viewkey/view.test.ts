/**
 * The view-key page's logic end to end, without a browser: the page's bridge, the viewer host with the
 * vendored production client module (79bf6de8…), the chain reads and Ozone's screening over a recording
 * fetch. Checks what the page shows (the viewer's warnings and labels) and what leaves it: no request
 * carries the file or any value of it but the addresses it lists.
 */
import { describe, expect, it } from 'vitest';
import { fakeNetwork, fixture } from './__fixtures__/fake-chain';
import { inProcessViewer, wasmBytes } from './__fixtures__/harness';
import { runView } from './controller';
import { CHAIN_SOURCES, type DeploymentConfig } from './config';
import { ViewerCallError } from './bridge';

const DEPLOYMENTS: DeploymentConfig[] = [{ chain_id: fixture.deployment.chain_id, proxy: fixture.deployment.proxy, label: 'fixture' }];
const FILE = fixture.file;
const C = fixture.counterparties;

async function viewer() {
	const v = inProcessViewer();
	await v.bridge.init(wasmBytes());
	return v;
}

/** Every value of the file that is not a public address, in the encodings a leak could take. */
function fileSecrets(): string[] {
	const j = JSON.parse(FILE) as Record<string, unknown> & { generations: { pk: string }[] };
	const hexes = [j.rk, j.nk, j.ck, j.checksum, ...j.generations.map((g) => g.pk)] as string[];
	const out: string[] = [FILE.trim(), FILE.slice(0, 40), fixture.fingerprint];
	for (const h of hexes) {
		out.push(h, h.toUpperCase(), h.slice(8, 40));
		const b = Buffer.from(h, 'hex');
		out.push(b.toString('base64').slice(4, 36), b.toString('base64url').slice(4, 36));
	}
	return out;
}

/** What a request shows: its URL (decoded), the protobuf of an abci_query decoded as text, and its body. */
function surface(c: { url: string; body: string | null }): string {
	const parts = [c.url, decodeURIComponent(c.url), c.body ?? ''];
	try {
		const data = new URL(c.url, 'https://ozone.test').searchParams.get('data');
		if (data?.startsWith('0x')) parts.push(Buffer.from(data.slice(2), 'hex').toString('latin1'));
	} catch {
		/* not a URL */
	}
	return parts.join('\n');
}

describe('view-key page: the view of a fixture account', () => {
	it('opens the file in the Worker, reads two sources, shows the history with its labels and the counterparties checked', async () => {
		const { bridge, toWorker } = await viewer();
		const net = fakeNetwork({ flagged: { [C.exchange]: 'Test list entry (fixture)' } });
		const steps: string[] = [];
		const { model, answers } = await runView({ bridge, text: FILE, deployments: DEPLOYMENTS, fetchFn: net.fetchFn, onStep: (s) => steps.push(s) });
		expect(steps).toEqual(['open', 'chain', 'payees', 'screen', 'done']);

		// the production module answers what the SDK's own viewer (test module) answered for this account, but
		// for what only the simulator's snapshot carries and no feed serves (an admitted deposit's sender, an
		// admitted return's own-money flag): the page reads the senders from the proxy's events instead
		expect(answers.status).toMatchObject({ synced: true, sources: 2, height: fixture.height, nk_check: 'verified' });
		expect(answers.notes).toEqual(fixture.expect.notes);
		const feedsOnly = (e: Record<string, unknown>) => (e.event === 'deposit' ? { ...e, source: null } : e.event === 'return' ? { ...e, own_funds: null } : e);
		expect(answers.history).toEqual(fixture.expect.history.map(feedsOnly));
		expect(answers.balances).toEqual(fixture.expect.balances);
		expect(answers.warnings).toEqual(fixture.expect.warnings);

		// warnings first, always: the file is not authenticated, its balances are no proof of funds
		expect(model.warnings[0]).toMatch(/^this view-key file is not authenticated/);
		expect(model.warnings[0]).toMatch(/Its balances are not a proof of funds/);
		expect(model.banners[0]).toMatchObject({ tone: 'bad', title: 'Not a proof of funds' });
		expect(model.banners.map((b) => b.title)).toContain('Keys confirmed by the chain');
		expect(model.banners.map((b) => b.title)).toContain('Exit addresses are the file’s claim');
		expect(model.banners.find((b) => b.title === 'Two sources agree')?.text).toContain(`block ${fixture.height}`);

		// claimed vs established
		expect(model.accounts).toHaveLength(1);
		expect(model.accounts[0]!.labels[0]).toEqual({ text: 'Established', tone: 'ok' });
		expect(model.exits).toHaveLength(1);
		expect(model.exits[0]!.labels[0]).toEqual({ text: "File's claim", tone: 'warn' });

		// the history, newest first, with depositors and payees from the proxy's events (another contract's
		// event and a failed transaction ignored) and the Spending account's own transaction
		const titles = model.history.map((h) => h.title);
		expect(titles).toEqual(['Queued payout', 'Withdrawal', 'Return from Spending', 'Spending account', 'Funding to Spending', 'Withdrawal', 'Deposit', 'Deposit', 'Deposit']);
		expect(model.history.filter((h) => h.title === 'Deposit').map((h) => h.parties[0]?.address)).toEqual([C.exchange, C.wallet, C.wallet]);
		const activity = model.history.find((h) => h.title === 'Spending account')!;
		expect(activity.parties).toEqual([{ address: C.bob, role: 'spending_payee' }]);
		expect(activity.amount).toBe('1 RUNE');
		const withdrawals = model.history.filter((h) => h.title === 'Withdrawal');
		expect(withdrawals.map((h) => h.parties[0]?.address)).toEqual([C.shop, C.bob]);
		expect(model.history.find((h) => h.title === 'Funding to Spending')?.parties[0]).toEqual({ address: C.spending, role: 'spending_account' });
		expect(model.history.find((h) => h.title === 'Return from Spending')?.labels.map((l) => l.text)).toEqual(['Established']);
		expect(model.history.find((h) => h.title === 'Queued payout')?.amount).toBe('10 RUNE');
		expect(model.balances).toEqual([{ denom: 'rune', amount: '40 RUNE' }]);

		// every counterparty checked; the flagged one first
		const addrs = model.counterparties.map((c) => c.address).sort();
		expect(addrs).toEqual([C.wallet, C.exchange, C.bob, C.shop, C.spending, ...fixture.expect.exitAddresses].sort());
		expect(model.counterparties.find((c) => c.address === C.bob)?.roles.sort()).toEqual(['payee', 'spending_payee']);
		expect(model.accounts[0]!.transactions).toBe(1);
		expect(model.counterparties[0]).toMatchObject({ address: C.exchange, label: { tone: 'bad' } });
		expect(model.counterparties[0]!.reasons[0]!.text).toBe('Test list entry (fixture)');
		expect(model.counterparties.find((c) => c.address === C.bob)?.label).toEqual({ text: 'Clear', tone: 'ok' });
		expect(model.screening).toMatchObject({ error: null, signed: true, snapshot: { version: 7 } });

		// the file went to the Worker once, in an `open` message, and nowhere else
		expect(toWorker.filter((m) => m.kind === 'open').map((m) => (m as { file: string }).file)).toEqual([FILE]);
		const key = JSON.parse(FILE) as { rk: string; nk: string; ck: string };
		for (const m of toWorker.filter((m) => m.kind !== 'open')) {
			const text = JSON.stringify(m);
			for (const x of [key.rk, key.nk, key.ck]) expect(text.includes(x)).toBe(false);
		}
		bridge.close();
	});

	it('sends nothing of the file: chain reads name the proxy, a height or a listed address; Ozone gets addresses only', async () => {
		const { bridge } = await viewer();
		const net = fakeNetwork();
		const { model } = await runView({ bridge, text: FILE, deployments: DEPLOYMENTS, fetchFn: net.fetchFn });
		expect(net.calls.length).toBeGreaterThan(10);
		const secrets = fileSecrets();
		for (const c of net.calls) {
			const s = surface(c);
			for (const x of secrets) expect(s.includes(x), `${c.method} ${c.url.slice(0, 80)} carries a value of the file`).toBe(false);
		}
		// only the two chain sources and Ozone's own screening endpoint; chain reads are plain GETs
		const origins = new Set(CHAIN_SOURCES.map((s) => s.rpc));
		for (const c of net.calls) {
			if (c.url === '/api/v1/screen') {
				expect(c.method).toBe('POST');
				const body = JSON.parse(c.body!);
				expect(Object.keys(body)).toEqual(['addresses']);
				for (const a of body.addresses) expect(model.counterparties.map((x) => x.address)).toContain(a);
			} else {
				expect([...origins].some((o) => c.url.startsWith(o + '/')), c.url).toBe(true);
				expect(c.method).toBe('GET');
				expect(c.body).toBeNull();
				expect(Object.keys(c.headers)).toEqual([]);
			}
		}
		// balances are asked only for the addresses the file lists (public)
		const balanceAsks = net.calls.filter((c) => surface(c).includes('cosmos.bank.v1beta1.Query/AllBalances'));
		expect(balanceAsks.length).toBe(2 * (fixture.expect.spendingAccounts.length + fixture.expect.exitAddresses.length));
		bridge.close();
	});
});

describe('view-key page: files it refuses (no request made)', () => {
	async function refused(text: string, deployments = DEPLOYMENTS) {
		const { bridge } = await viewer();
		const net = fakeNetwork();
		const err = await runView({ bridge, text, deployments, fetchFn: net.fetchFn }).then(
			() => null,
			(e) => e as ViewerCallError
		);
		bridge.close();
		expect(net.calls, 'a refused file causes no request').toEqual([]);
		return err!;
	}

	it('a secret-named member', async () => {
		const e = await refused(FILE.replace('"rk":"', `"sk":"${'00'.repeat(32)}","rk":"`));
		expect(e.code).toBe('VIEW_KEY_INVALID');
		expect(e.message).toMatch(/forbidden secret field/);
	});

	it('a changed value (checksum)', async () => {
		const j = JSON.parse(FILE);
		const flipped = j.rk.slice(0, -1) + (j.rk.endsWith('0') ? '1' : '0');
		const e = await refused(FILE.replace(j.rk, flipped));
		expect(e.code).toBe('VIEW_KEY_INVALID');
	});

	it('non-canonical text (whitespace)', async () => {
		const e = await refused(FILE.replace('{"version":', '{ "version":'));
		expect(e.code).toBe('VIEW_KEY_INVALID');
	});

	it('not JSON at all', async () => {
		const e = await refused('hello');
		expect(e.code).toBe('VIEW_KEY_INVALID');
	});

	it('a deployment Ozone does not read', async () => {
		const e = await refused(FILE, [{ chain_id: 'thorchain-1', proxy: fixture.deployment.proxy }]);
		expect(e.code).toBe('UNKNOWN_DEPLOYMENT');
	});

	it('a client module that is not the pinned one', async () => {
		const v = inProcessViewer();
		const bytes = new Uint8Array(wasmBytes());
		bytes[bytes.length - 1] ^= 1;
		await expect(v.bridge.init(bytes.buffer)).rejects.toMatchObject({ code: 'WASM_INTEGRITY' });
		await expect(v.bridge.open(FILE, DEPLOYMENTS)).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
		v.bridge.close();
	});
});

describe('view-key page: the two-source check', () => {
	it('refuses when the sources disagree at one height (C5)', async () => {
		const { bridge } = await viewer();
		const feedsB = structuredClone(fixture.feeds);
		(feedsB.queue[0] as { recipient: string }).recipient = C.bob;
		const net = fakeNetwork({ feedsB });
		await expect(runView({ bridge, text: FILE, deployments: DEPLOYMENTS, fetchFn: net.fetchFn })).rejects.toMatchObject({ code: 'REPLAY' });
		expect(net.calls.some((c) => c.url === '/api/v1/screen')).toBe(false);
		bridge.close();
	});

	it('refuses a source on another chain, and sources far apart', async () => {
		for (const opts of [{ networkB: 'thorchain-stagenet-2' }, { tipB: fixture.height + 50 }]) {
			const { bridge } = await viewer();
			const net = fakeNetwork(opts);
			await expect(runView({ bridge, text: FILE, deployments: DEPLOYMENTS, fetchFn: net.fetchFn })).rejects.toMatchObject({
				code: opts.networkB ? 'CHAIN_MISMATCH' : 'SOURCES_DISAGREE'
			});
			bridge.close();
		}
	});

	it('shows the view without verdicts when Ozone cannot screen', async () => {
		const { bridge } = await viewer();
		const net = fakeNetwork({ screenDown: true });
		const { model } = await runView({ bridge, text: FILE, deployments: DEPLOYMENTS, fetchFn: net.fetchFn });
		expect(model.screening.error).toBe('Screening data unavailable');
		expect(model.counterparties.every((c) => c.label.text === 'Not checked')).toBe(true);
		expect(model.banners[0]!.title).toBe('Not a proof of funds');
		bridge.close();
	});
});
