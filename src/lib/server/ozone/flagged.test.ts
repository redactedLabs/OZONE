/**
 * The two public "flagged" numbers (all flagged addresses; flagged thor1
 * addresses) and their lists: computed from the signed snapshot only, one
 * count per key, and nothing but address, chain, risk, codes, sources and
 * incident in a row.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSnapshot, decodePayload, generateSigningKey, loadPrivateKey, type Reason } from '$ozone/index.js';
import { applySourceResult, emptyResult, migrate, publishSnapshot, recordHits, type ListEntry, type Sql, type TraceHit } from '$engine/index.js';
import { chainOfKey, flaggedCsv, flaggedMatches, flaggedPage, summarizeFlagged } from './flagged';

const holder: { sql?: Sql } = {};
vi.mock('$lib/server/ozone/sql', () => ({
	get sql() {
		return holder.sql;
	}
}));
const snapKey = loadPrivateKey(generateSigningKey().seedHex);
process.env.OZONE_SNAPSHOT_PUBLIC_KEYS = snapKey.publicKey.spec;

const EVM_SANCTIONED = 'evm:0x098b716b8aaf21512996dc57eb0615e2383e2f96';
const EVM_HACK = 'evm:0xeb31973e0febf3e3d7058234a5ebbae1ab4b8c23';
const EVM_PHISH = 'evm:0x00000000000000000000000000000000000000b0';
const EVM_DELISTED = 'evm:0x8589427373d6d84e98730d7795d8f6f8731fda16';
const TRON_TWIN = 'tron:TPysFFEH9vYWV8GTUfaAvHXqT5hRSvC7eo';
const BTC_TRACED = 'btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE';
const BTC_HOP2 = 'btc:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const THOR_TRACED = 'thor:thor1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg386we8s';
const THOR_LINKED = 'thor:thor1fns25sytpf2gsdlg76g45620u5axm4mkrypqrh';
const THOR_LINKED_WEAK = 'thor:thor1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zg8tl08';

const r = (p: Partial<Reason> & Pick<Reason, 'code' | 'source' | 'category' | 'risk'>): Reason => ({ text: `${p.code} reason`, ...p });
const trace = (originEntity: string, hop = 1) => ({ hop, action: 'swap', txid: 'ABC', from: '0xfrom', originKey: EVM_HACK, originSource: 'curated', originEntity });

function snapshot(records: Array<{ key: string; reasons: Reason[] }>) {
	const sources = ['ofac_sdn', 'curated', 'scamsniffer', 'key_twin', 'thorchain_trace', 'thorchain_links'].map((id) => ({ id, name: id, kind: 'test', entries: 0 }));
	const built = buildSnapshot({ version: 1790000000, builtAt: '2026-09-28T00:00:00.000Z', sources, records });
	return decodePayload(built.manifest, built.payload);
}

const RECORDS = [
	// one key, two sources (sanctions + a trace): counted once, under both sources
	{
		key: EVM_SANCTIONED,
		reasons: [
			r({ code: 'OFAC_SDN', source: 'ofac_sdn', category: 'sanctions', risk: 'severe', entity: 'Lazarus Group' }),
			r({ code: 'TRACE_SWAP', source: 'thorchain_trace', category: 'traced', risk: 'high', trace: trace('Bybit hack') })
		]
	},
	{ key: EVM_HACK, reasons: [r({ code: 'HACK_INCIDENT', source: 'curated', category: 'hack', risk: 'severe', entity: 'KuCoin hack (2020-09-26)' })] },
	{ key: EVM_PHISH, reasons: [r({ code: 'PHISHING', source: 'scamsniffer', category: 'phishing', risk: 'medium' })] },
	{ key: EVM_DELISTED, reasons: [r({ code: 'OFAC_SDN', source: 'ofac_sdn', category: 'sanctions', risk: 'severe', removedAt: '2025-03-21T00:00:00Z' })] },
	{ key: TRON_TWIN, reasons: [r({ code: 'SAME_KEY', source: 'key_twin', category: 'key_twin', risk: 'high', entity: 'Lazarus Group' })] },
	{ key: BTC_TRACED, reasons: [r({ code: 'TRACE_SWAP', source: 'thorchain_trace', category: 'traced', risk: 'high', trace: trace('Bybit hack (2025-02-21)') })] },
	{ key: BTC_HOP2, reasons: [r({ code: 'TRACE_SWAP', source: 'thorchain_trace', category: 'traced', risk: 'medium', trace: trace('Bybit hack', 2) })] },
	{ key: THOR_TRACED, reasons: [r({ code: 'TRACE_SEND', source: 'thorchain_trace', category: 'traced', risk: 'high', trace: trace('KuCoin hack (2020-09-26)') })] },
	{ key: THOR_LINKED, reasons: [r({ code: 'LINKED_OFAC_SDN', source: 'thorchain_links', category: 'linked', risk: 'high' })] },
	{ key: THOR_LINKED_WEAK, reasons: [r({ code: 'LINKED_PHISHING', source: 'thorchain_links', category: 'linked', risk: 'medium' })] }
];

describe('flagged counters (pure, from a snapshot)', () => {
	const s = summarizeFlagged(snapshot(RECORDS));

	it('counts every key at risk high or above once, all chains, and the thor1 keys separately', () => {
		// flagged: sanctioned EVM key, hack EVM key, TRON twin, BTC hop-1 trace, thor1 trace, thor1 link
		expect(s.counts).toEqual({ flaggedAddresses: 6, flaggedThorAddresses: 2 });
		expect(s.byKind).toEqual({ listed: 2, traced: 2, linked: 1, twin: 1 });
		// the weak link (risk medium: one level below a high listing) is carried by the snapshot but does not reach the flag level
		expect(s.linkedAccounts).toBe(2);
		expect(s.thorByKind).toEqual({ listed: 0, traced: 1, linked: 1, twin: 0 });
		// never flagged: medium phishing, delisted (history), medium hop-2 trace, medium link
		const flaggedAddrs = s.rows.map((x) => `${x.chain}:${x.address}`);
		for (const k of [EVM_PHISH, EVM_DELISTED, BTC_HOP2, THOR_LINKED_WEAK]) {
			expect(flaggedAddrs).not.toContain(`${chainOfKey(k)}:${k.slice(k.indexOf(':') + 1)}`);
		}
	});

	it('breaks down by source (a key under each of its flagging sources) and by chain (each key once)', () => {
		expect(Object.fromEntries(s.bySource.map((x) => [x.source, x.keys]))).toEqual({
			thorchain_trace: 3,
			ofac_sdn: 1,
			curated: 1,
			key_twin: 1,
			thorchain_links: 1
		});
		expect(Object.fromEntries(s.byChain.map((x) => [x.chain, x.keys]))).toEqual({ EVM: 2, THOR: 2, TRON: 1, BTC: 1 });
		expect(Object.fromEntries(s.thorBySource.map((x) => [x.source, x.keys]))).toEqual({ thorchain_trace: 1, thorchain_links: 1 });
		expect(s.byChain.reduce((n, c) => n + c.keys, 0)).toBe(s.counts.flaggedAddresses);
	});

	it('rows carry only public snapshot fields, strongest first, with the incident', () => {
		for (const row of s.rows) expect(Object.keys(row).sort()).toEqual(['address', 'chain', 'codes', 'incident', 'kind', 'risk', 'sources']);
		expect(s.rows[0].risk).toBe('severe');
		const sanctioned = s.rows.find((x) => x.address === EVM_SANCTIONED.slice(4))!;
		expect(sanctioned).toMatchObject({ chain: 'EVM', risk: 'severe', kind: 'listed', codes: ['OFAC_SDN', 'TRACE_SWAP'], sources: ['ofac_sdn', 'thorchain_trace'] });
		expect(s.rows.find((x) => x.address === EVM_HACK.slice(4))!.incident).toBe('KuCoin hack (2020-09-26)');
		expect(s.rows.find((x) => x.address === BTC_TRACED.slice(4))).toMatchObject({ kind: 'traced', incident: 'Bybit hack (2025-02-21)', chain: 'BTC' });
		expect(s.rows.find((x) => x.address === THOR_LINKED.slice(5))).toMatchObject({ kind: 'linked', chain: 'THOR', codes: ['LINKED_OFAC_SDN'] });
	});

	it('pages, filters and exports a list', () => {
		expect(flaggedPage(s, { list: 'thor' }).total).toBe(2);
		expect(flaggedPage(s, { list: 'thor' }).rows.every((x) => x.chain === 'THOR')).toBe(true);
		expect(flaggedPage(s, { list: 'all', q: 'kucoin' }).total).toBe(2); // the listed key and the thor1 key traced from it
		expect(flaggedPage(s, { list: 'all', source: 'ofac_sdn' }).total).toBe(1);
		expect(flaggedPage(s, { list: 'all', chain: 'evm' }).total).toBe(2);
		const p1 = flaggedPage(s, { list: 'all', offset: 0, limit: 4 });
		const p2 = flaggedPage(s, { list: 'all', offset: 4, limit: 4 });
		expect(p1.rows).toHaveLength(4);
		expect(p2.rows).toHaveLength(2);
		expect(new Set([...p1.rows, ...p2.rows].map((x) => x.address)).size).toBe(6);
		// a page holds at most 1,000 rows; an export has every match
		expect(flaggedPage(s, { list: 'all', limit: 5000 }).rows).toHaveLength(6);
		expect(flaggedMatches(s, { list: 'all' })).toHaveLength(6);
		const csv = flaggedCsv(s.rows).split('\n');
		expect(csv[0]).toBe('address,chain,risk,kind,codes,sources,incident');
		expect(csv).toHaveLength(7);
	});
});

describe('/api/flagged and the home page numbers (embedded Postgres, published snapshot)', () => {
	let db: PGlite;
	beforeAll(async () => {
		db = await PGlite.create();
		holder.sql = db as unknown as Sql;
		await migrate(holder.sql, { baseline: true });
	});
	afterAll(() => db.close());

	it('serves both counters and their lists, consistent with verdicts, plus the monitored-accounts count', async () => {
		const sql = holder.sql!;
		const entry = (source: string, key: string, address: string, chain: string, extra: Partial<ListEntry>): ListEntry => ({
			source,
			key,
			chain,
			address,
			category: 'sanctions',
			risk: 'severe',
			code: 'TEST',
			text: 'test',
			...extra
		});
		const ofac = emptyResult();
		ofac.entries.push(entry('ofac_sdn', EVM_SANCTIONED, EVM_SANCTIONED.slice(4), 'ETH', { code: 'OFAC_SDN', entity: 'Lazarus Group' }));
		await applySourceResult(sql, { id: 'ofac_sdn', name: 'OFAC', kind: 'sanctions' }, ofac);
		const scam = emptyResult();
		scam.entries.push(entry('scamsniffer', EVM_PHISH, EVM_PHISH.slice(4), 'ETH', { category: 'phishing', risk: 'medium', code: 'PHISHING' }));
		await applySourceResult(sql, { id: 'scamsniffer', name: 'ScamSniffer', kind: 'community' }, scam);
		const hit = (toKey: string, toAddress: string, toChain: string): TraceHit => ({
			txid: `TX${toAddress.slice(-6)}`,
			height: 1000,
			date: '2025-02-25T00:00:00.000Z',
			action: 'swap',
			relation: 'value',
			fromKey: EVM_SANCTIONED,
			fromAddress: EVM_SANCTIONED.slice(4),
			fromChain: 'ETH',
			toKey,
			toAddress,
			toChain,
			amount: '1 BTC.BTC',
			usd: 90_000,
			hop: 1,
			risk: 'high',
			originKey: EVM_SANCTIONED,
			originSource: 'ofac_sdn',
			originEntity: 'Lazarus Group',
			originRisk: 'severe',
			originCategory: 'sanctions'
		});
		await recordHits(sql, [hit(BTC_TRACED, BTC_TRACED.slice(4), 'BTC'), hit(THOR_TRACED, THOR_TRACED.slice(5), 'THOR')]);
		// a monitored account flagged through a link (the old "Flagged THORChain Users" number)
		await sql.query(`INSERT INTO rujira_users (thor_address, flagged, risk, flag_reason) VALUES ($1, true, 'high', 'linked to a listed L1 address')`, [
			THOR_LINKED.slice(5)
		]);
		for (const id of ['uk_fcdo', 'eu_fsf', 'fbi', 'curated', 'chainalysis_oracle', 'tether', 'circle']) {
			await applySourceResult(sql, { id, name: id, kind: 'sanctions' }, emptyResult());
		}
		const pub = await publishSnapshot(sql, snapKey, { coreSources: [] });
		expect(pub.published).toBe(true);

		const { GET } = await import('../../../routes/api/flagged/+server');
		const call = async (path: string) => {
			const url = new URL(path, 'https://ozone.test');
			return (GET as (e: unknown) => Promise<Response>)({ url, request: new Request(url), params: {}, locals: { user: null } });
		};
		const summary = (await (await call('/api/flagged')).json()) as {
			meta: { counts: Record<string, number>; lists: Record<string, string>; totalFlagged: number; flaggedThorUsers: number; breakdown: { byKind: Record<string, number>; linkedAccounts: number } };
			monitoredThorAccountsFlagged: unknown[];
			flaggedAddresses: unknown[];
		};
		// OFAC key + its TRON twin + the two traced keys; the medium phishing entry is listed, not flagged
		expect(summary.meta.counts).toEqual({ flaggedAddresses: 4, flaggedThorAddresses: 1, monitoredThorAccountsFlagged: 1 });
		expect(summary.meta.breakdown.byKind).toEqual({ listed: 1, traced: 2, linked: 0, twin: 1 });
		expect(summary.meta.breakdown.linkedAccounts).toBe(0);
		expect(summary.meta.lists).toMatchObject({ flaggedAddresses: '/api/flagged?list=all', flaggedThorAddresses: '/api/flagged?list=thor' });
		// legacy fields keep their old meaning (monitored accounts)
		expect(summary.meta.totalFlagged).toBe(1);
		expect(summary.meta.flaggedThorUsers).toBe(1);
		expect(summary.flaggedAddresses).toHaveLength(1);

		const all = (await (await call('/api/flagged?list=all&limit=2')).json()) as { meta: { total: number; snapshot: { signed: boolean } }; addresses: Array<Record<string, unknown>> };
		expect(all.meta.total).toBe(4);
		expect(all.meta.snapshot.signed).toBe(true);
		expect(all.addresses).toHaveLength(2);
		const thor = (await (await call('/api/flagged?list=thor')).json()) as { meta: { total: number }; addresses: Array<{ address: string; chain: string; kind: string }> };
		expect(thor.meta.total).toBe(1);
		expect(thor.addresses[0]).toMatchObject({ address: THOR_TRACED.slice(5), chain: 'THOR', kind: 'traced' });
		const csv = await (await call('/api/flagged?list=all&format=csv')).text();
		expect(csv.split('\n')).toHaveLength(5);
		expect((await call('/api/flagged?list=nope')).status).toBe(400);

		// the counters agree with the verdicts nodes compute from the same snapshot
		const { currentSnapshot } = await import('./snapshot');
		const snap = (await currentSnapshot())!;
		let flagged = 0;
		for (const key of snap.index.keys()) if (snap.index.screen(key.slice(key.indexOf(':') + 1)).status === 'flagged') flagged++;
		expect(flagged).toBe(summary.meta.counts.flaggedAddresses);
	});
});
