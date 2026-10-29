/**
 * The page with a history file (errata E-68) end to end, without a browser: the page's bridge, the viewer host
 * with the vendored production client module (9a945b79…), the chain reads (feeds at the tip, the cut's block
 * inside this viewer's window) and Ozone's screening over a recording fetch. Checks the warnings and verdicts the
 * page shows, that nothing after the cut shows, that no request carries the file, a value of it or the window
 * seed, and how the seed is kept per fingerprint.
 */
import { describe, expect, it } from 'vitest';
import { fakeNetwork, historyFixture as HF, type ChainFixture, type FakeOptions } from './__fixtures__/fake-chain';
import { inProcessViewer, wasmBytes } from './__fixtures__/harness';
import { runView } from './controller';
import { CHAIN_SOURCES, type DeploymentConfig } from './config';
import type { HistoryAnswers, HistoryModel } from './model-history';
import { SEED_NOT_KEPT } from './model-history';
import type { SeedStorage } from './seed';
import { historyCutWindow } from '$lib/vendor/vault-sdk/viewer.js';
import type { ViewerCallError } from './bridge';

const FX = HF as unknown as ChainFixture;
const DEPLOYMENTS: DeploymentConfig[] = [{ chain_id: HF.deployment.chain_id, proxy: HF.deployment.proxy }];
const FILE = HF.files.default.file;
const FILE_HELD = HF.files.held_nullifiers.file;
const C = HF.counterparties;
const E = HF.expect.default;

class MemStorage implements SeedStorage {
	m = new Map<string, string>();
	getItem(k: string) {
		return this.m.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, v);
	}
}

async function runHist(text: string, storage: SeedStorage | null, opts: FakeOptions = {}, deployments = DEPLOYMENTS) {
	const v = inProcessViewer();
	await v.bridge.init(wasmBytes());
	const net = fakeNetwork({ fx: FX, ...opts });
	try {
		const r = await runView({ bridge: v.bridge, text, kind: 'history', deployments, fetchFn: net.fetchFn, seedStorage: storage });
		if (r.model.kind !== 'history') throw new Error('not a history view');
		return { model: r.model as HistoryModel, answers: r.answers as HistoryAnswers, calls: net.calls, toWorker: v.toWorker };
	} finally {
		v.bridge.close();
	}
}

async function refusedHist(text: string, storage: SeedStorage | null = new MemStorage(), opts: FakeOptions = {}, deployments = DEPLOYMENTS) {
	const v = inProcessViewer();
	await v.bridge.init(wasmBytes());
	const net = fakeNetwork({ fx: FX, ...opts });
	const err = await runView({ bridge: v.bridge, text, kind: 'history', deployments, fetchFn: net.fetchFn, seedStorage: storage }).then(
		() => null,
		(e) => e as ViewerCallError
	);
	v.bridge.close();
	return { err: err!, calls: net.calls };
}

const blockHeights = (calls: { url: string }[], rpc: string) =>
	calls.filter((c) => c.url.startsWith(rpc + '/blockchain')).map((c) => Number(new URL(c.url).searchParams.get('minHeight')));

describe('history file: the view at its cut', () => {
	it('checks every listed note at the cut from two sources and shows the warnings first, the verdicts, the totals and the named addresses', async () => {
		const storage = new MemStorage();
		const { model, answers } = await runHist(FILE, storage, { flagged: { [C.exchange]: 'Test list entry (fixture)' } });
		// the production module answers what the SDK's own viewer (test module) answered for this file
		expect(answers.status).toEqual(E.status);
		expect(answers.items).toEqual(E.items);
		expect(answers.totals).toEqual(E.totals);
		expect(answers.accounts).toEqual(E.accounts);
		expect(answers.warnings).toEqual(E.warnings);

		// warnings first, always
		expect(model.warnings[0]).toMatch(/not authenticated/);
		expect(model.warnings[0]).toMatch(/not a proof of funds/);
		const titles = model.banners.map((b) => b.title);
		expect(model.banners[0]).toMatchObject({ tone: 'bad', title: 'Not a proof of funds' });
		expect(titles.slice(1, 5)).toEqual(['Completeness rests on the owner', `Cut at block ${HF.cut.toLocaleString('en-US')}`, 'Held notes not checked', 'Payees and exit addresses are the file’s statement']);
		expect(titles).toContain('Every listed note checked at the cut');
		expect(titles).toContain('Two sources agree at the cut');
		expect(model.seedNote).toBeNull();

		// per-item verdicts; depositors from the proxy's events up to the cut; payees stated, and in the spend event
		expect(model.items.map((i) => i.verdict.text)).toEqual(E.items.map(() => 'Verified'));
		expect(model.items.filter((i) => i.title === 'Deposit').map((i) => i.parties[0]?.address)).toEqual([C.wallet, C.wallet, C.exchange]);
		const first = model.items.find((i) => i.index === 0)!;
		expect(first.parties.find((p) => p.role === 'payee')?.address).toBe(C.bob);
		expect(first.labels.map((l) => l.text)).toEqual(['Payee stated by the file', 'Payee in the spend event']);
		expect(model.items.filter((i) => i.fate === 'Held at the cut').every((i) => i.labels.some((l) => l.text === 'Held: not checked'))).toBe(true);

		// totals at the cut, over the verified notes
		expect(model.totals).toEqual([{ denom: 'rune', held: '42 RUNE', heldConfirmed: null, deposited: '55 RUNE', returned: '4 RUNE', gifts: '0 RUNE', left: '17 RUNE' }]);

		// named addresses with roles, screened; the flagged one first
		expect(model.counterparties.map((c) => c.address).sort()).toEqual([C.wallet, C.exchange, C.bob, C.shop, C.spending].sort());
		expect(model.counterparties[0]).toMatchObject({ address: C.exchange, label: { tone: 'bad' } });
		expect(model.counterparties.find((c) => c.address === C.spending)?.roles.sort()).toEqual(['returning_account', 'spending_account']);
		expect(model.items.find((i) => i.parties.some((p) => p.address === C.spending && p.role === 'spending_account'))?.fate).toMatch(/: funding to Spending$/);
		expect(first.fate).toMatch(/: withdrawal$/);
		expect(model.accounts).toEqual([{ address: C.spending, kind: 'spending', label: { text: 'On chain at the cut', tone: 'ok' } }]);

		// nothing after the cut: not the later note, not its payee
		const shown = JSON.stringify(model);
		for (const cm of HF.after_cut.notes) expect(shown.includes(cm)).toBe(false);
		expect(shown.includes(HF.after_cut.payee)).toBe(false);
	});

	it('sends nothing of the file and never the seed; asks the block hashes of this viewer’s window only, without naming the cut', async () => {
		const storage = new MemStorage();
		const { calls, toWorker } = await runHist(FILE, storage);
		const seed = [...storage.m.values()][0]!;
		expect(seed).toMatch(/^[0-9a-f]{64}$/);
		const j = JSON.parse(FILE) as { checksum: string; generations: { pk: string }[]; notes: { rho: string }[] };
		const secrets = [FILE.slice(0, 48), j.checksum, HF.files.default.fingerprint, seed, ...j.generations.map((g) => g.pk), ...j.notes.map((n) => n.rho), HF.view_key_values.rk, HF.view_key_values.nk, HF.view_key_values.ck];
		for (const c of calls) {
			let s = `${c.url}\n${decodeURIComponent(c.url)}\n${c.body ?? ''}`;
			const data = new URL(c.url, 'https://ozone.test').searchParams.get('data');
			if (data?.startsWith('0x')) s += Buffer.from(data.slice(2), 'hex').toString('latin1');
			for (const x of [...secrets, ...secrets.map((h) => h.toUpperCase())]) expect(s.includes(x), `${c.method} ${c.url.slice(0, 90)}`).toBe(false);
			if (c.url === '/api/v1/screen') expect(Object.keys(JSON.parse(c.body!))).toEqual(['addresses']);
			else expect(CHAIN_SOURCES.some((src) => c.url.startsWith(src.rpc + '/'))).toBe(true);
		}
		// the seed stays in the page: it is in no message to the Worker either but the answer the Worker asked for
		expect(toWorker.filter((m) => JSON.stringify(m).includes(seed)).map((m) => m.kind)).toEqual(['env-reply']);
		// block hashes: exactly this viewer's window (8 to 24 heights around the cut) from each source
		const [lo, hi] = await historyCutWindow(seed, HF.cut);
		const want = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
		for (const src of CHAIN_SOURCES) expect(blockHeights(calls, src.rpc).sort((x, y) => x - y)).toEqual(want);
		expect(hi - lo + 1).toBeGreaterThanOrEqual(8);
		expect(lo <= HF.cut && HF.cut <= hi).toBe(true);
		// the proxy's history is read up to the height read, not up to the cut
		const searches = calls.filter((c) => c.url.includes('/tx_search'));
		expect(searches.length).toBeGreaterThan(0);
		for (const c of searches) expect(JSON.parse(new URL(c.url).searchParams.get('query')!)).toMatch(new RegExp(`tx\\.height<=${HF.height}$`));
	});

	it('keeps one seed per fingerprint: the same window when this browser checks the file again, another for another file', async () => {
		const storage = new MemStorage();
		const one = await runHist(FILE, storage);
		const two = await runHist(FILE, storage);
		expect(storage.m.size).toBe(1);
		const key = `ozone.view.window-seed.${HF.files.default.fingerprint}`;
		expect(storage.m.has(key)).toBe(true);
		for (const src of CHAIN_SOURCES) expect(new Set(blockHeights(two.calls, src.rpc))).toEqual(new Set(blockHeights(one.calls, src.rpc)));
		await runHist(FILE_HELD, storage);
		expect(storage.m.size).toBe(2);
		expect(storage.m.get(`ozone.view.window-seed.${HF.files.held_nullifiers.fingerprint}`)).not.toBe(storage.m.get(key));
	});

	it('without storage for the page: one line says repeat checks may reveal the cut', async () => {
		const broken: SeedStorage = {
			getItem() {
				throw new Error('SecurityError');
			},
			setItem() {
				throw new Error('SecurityError');
			}
		};
		const a = await runHist(FILE, broken);
		expect(a.model.seedNote).toBe(SEED_NOT_KEPT);
		expect(SEED_NOT_KEPT).toMatch(/repeat|again/);
		expect(SEED_NOT_KEPT).toMatch(/node operators/);
		const b = await runHist(FILE, null);
		expect(b.model.seedNote).toBe(SEED_NOT_KEPT);
		expect(b.model.items.every((i) => i.verdict.text === 'Verified')).toBe(true);
	});

	it('held nullifiers included: held notes confirmed unspent at the cut, and the banner says their next move is visible', async () => {
		const { model, answers } = await runHist(FILE_HELD, new MemStorage());
		expect(answers.items).toEqual(HF.expect.held_nullifiers.items);
		const held = model.items.filter((i) => i.fate === 'Held at the cut');
		expect(held.length).toBeGreaterThan(0);
		expect(held.every((i) => i.labels.some((l) => l.text === 'Unspent at the cut'))).toBe(true);
		expect(model.banners.map((b) => b.title)).toContain('Held notes checked, their next move visible');
		expect(model.totals[0]!.heldConfirmed).toBe('42 RUNE');
	});
});

describe('history file: what the page refuses', () => {
	it('parse errors (no request made): a secret-named member, a changed value, non-canonical text, another deployment', async () => {
		const cases: [string, string, RegExp | null][] = [
			[FILE.replace('"deployment_id"', `"rk":"${'00'.repeat(32)}","deployment_id"`), 'HISTORY_INVALID', /forbidden secret field/],
			[FILE.replace(/"checksum":"([0-9a-f])/, (_m, c: string) => `"checksum":"${c === '0' ? '1' : '0'}`), 'HISTORY_INVALID', null],
			[FILE.replace('{"version":', '{ "version":'), 'HISTORY_INVALID', null],
			[FILE.replace('"notes":[', '"notes" :['), 'HISTORY_INVALID', null]
		];
		for (const [text, code, msg] of cases) {
			const { err, calls } = await refusedHist(text);
			expect(err.code).toBe(code);
			if (msg) expect(err.message).toMatch(msg);
			expect(calls).toEqual([]);
		}
		const other = await refusedHist(FILE, new MemStorage(), {}, [{ chain_id: 'thorchain-1', proxy: HF.deployment.proxy }]);
		expect(other.err.code).toBe('UNKNOWN_DEPLOYMENT');
		expect(other.calls).toEqual([]);
	});

	it('a source whose block at the cut is not the file’s (another chain, a wrong cut) is refused; nothing is screened', async () => {
		const { err, calls } = await refusedHist(FILE, new MemStorage(), { blockHashB: '11'.repeat(32).toUpperCase() });
		expect(err.code).toBe('REPLAY');
		expect(calls.some((c) => c.url === '/api/v1/screen')).toBe(false);
	});

	it('too early: a window that reaches above the chain read is checked later', async () => {
		// a seed whose window for this cut reaches above it, and a chain read only up to the cut
		let seed = '';
		for (let k = 1; k < 256 && !seed; k++) {
			const s = k.toString(16).padStart(2, '0').repeat(32);
			if ((await historyCutWindow(s, HF.cut))[1] > HF.cut) seed = s;
		}
		expect(seed).not.toBe('');
		const storage = new MemStorage();
		storage.setItem(`ozone.view.window-seed.${HF.files.default.fingerprint}`, seed);
		const { err } = await refusedHist(FILE, storage, { fx: { ...FX, height: HF.cut } });
		expect(err.code).toBe('NEEDS_SYNC');
	});
});
