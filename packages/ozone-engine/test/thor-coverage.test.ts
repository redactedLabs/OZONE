/**
 * thor1 coverage (pass G): flows into thor1 accounts that the tracer missed,
 * and the guards that keep the affiliate rules from becoming an exemption.
 *
 * - Bond providers: the malicious validator of the THORChain vault exploit
 *   (2026-05-15, listed by the curated source) was churned in with "~635,000
 *   RUNE across two different bond addresses" (THORChain's post-mortem). Its
 *   Midgard history (read 2026-10-08) shows both: their own BOND actions to
 *   the node, after the node's operator whitelisted them. Nothing linked
 *   them to the node before.
 * - A fee collector is a service only while it is not flagged high in its
 *   own right: anyone can name any address as affiliate, so fees must not
 *   exempt a flagged account from being followed, as an action count must not.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { action, FakeMidgard, memoryDb } from './helpers.js';
import { extractFlows, MIN_BOND_RUNE } from '../src/trace/flows.js';
import { DEFAULT_TRACE_CONFIG, traceAction, type IndexEntry, type TraceHit } from '../src/trace/tracer.js';
import { StaticPrices } from '../src/trace/prices.js';
import { checkAddress, runTraceBackfill } from '../src/trace/jobs.js';
import type { MidgardAction, MidgardLike } from '../src/trace/midgard.js';
import { applySourceResult } from '../src/store/entries.js';
import { getState, loadTraceIndex, maybeResetBackfill, recordHits } from '../src/store/trace.js';
import { emptyResult } from '../src/types.js';

const NODE = 'thor16ucjv3v695mq283me7esh0wdhajjalengcn84q'; // the malicious validator (curated, INCIDENT_EXPLOITER)
const P1 = 'thor198ry37gqpzjqa3ye4fhr6g7mysk8640293zw4e';
const P2 = 'thor1e83t246wtulelve756x3er098ej733dsvtnzxj';
const BOND_MODULE = 'thor17gw75axcnr8747pkanye45pnrwk7p9c3cqncsv';
const prices = new StaticPrices(new Map(Object.entries({ 'THOR.RUNE': 1.5, 'ETH.ETH': 2400 })));

const bond = (height: number, from: string, amount: number, memo: string, extra: Record<string, unknown> = {}, txID?: string): MidgardAction =>
	action({
		type: 'bond',
		height,
		in: [{ address: from, asset: 'THOR.RUNE', amount, ...(txID ? { txID } : {}) }],
		out: [{ address: BOND_MODULE, asset: 'THOR.RUNE', amount }],
		metadata: { bond: { memo, nodeAddress: NODE, ...extra } }
	});

/** The node's history as Midgard returns it (2026-10-08), oldest first; amounts in RUNE. */
function nodeHistory(): MidgardAction[] {
	return [
		// the operator whitelists P1 (1e-8 RUNE, signed by the node itself)
		bond(25_923_004, NODE, 1e-8, `BOND:${NODE}:${P1}`, { provider: P1 }, 'CE389C85F5B87D8258AA65FDD96540DC207CBA8C166D0D3B443FC8E6A3BB2D4B'),
		bond(25_923_152, P1, 139_472.61937665, `BOND:${NODE}`),
		action({
			type: 'unbond',
			height: 25_970_285,
			in: [{ address: P1, asset: 'THOR.RUNE', amount: 0 }],
			out: [{ address: BOND_MODULE, asset: 'THOR.RUNE', amount: 200_000 }],
			metadata: { bond: { memo: `UNBOND:${NODE}:20000000000000`, nodeAddress: NODE } }
		}),
		bond(26_136_893, NODE, 1, `BOND:${NODE}:${P2}:500`, { provider: P2, fee: '500' }, 'F38783BBB4C11B11436D62965E9ECE5E516093A9AACBF9DE9065F8CA9F0DE126'),
		bond(26_136_965, P2, 100, `BOND:${NODE}`),
		bond(26_143_887, P2, 5_000, `BOND:${NODE}`, {}, '6537914665A136491823A8DEECD099B0E2E12DD9AD3204A43C4417DCA93CE536')
	];
}

const listedNode: IndexEntry = { key: `thor:${NODE}`, hop: 0, originRisk: 'severe', originKey: `thor:${NODE}`, originSource: 'curated', originEntity: 'THORChain vault exploit by a malicious validator (2026-05-15)', originCategory: 'hack' };

describe('bond providers of a flagged node', () => {
	it('a provider\'s own bond links the node to it; the whitelisting, an unbond and a token bond do not', () => {
		const flows = nodeHistory().flatMap((a) => extractFlows(a, prices));
		expect(flows.map((f) => [f.relation, f.fromAddress, f.toAddress])).toEqual([
			['bond', NODE, P1],
			['bond', NODE, P2],
			['bond', NODE, P2]
		]);
		expect(flows[0].amount).toBe('139472.6194 THOR.RUNE');
		expect(extractFlows(bond(1, P1, MIN_BOND_RUNE / 10, `BOND:${NODE}`), prices)).toEqual([]);
	});

	it('the providers of a listed node are traced one hop from it, at high, with the bond as provenance', () => {
		const lookup = (k: string) => (k === listedNode.key ? listedNode : undefined);
		const hits = nodeHistory().flatMap((a) => traceAction(a, lookup, prices));
		expect(hits.map((h) => [h.toAddress, h.hop, h.risk, h.relation])).toEqual([
			[P1, 1, 'high', 'bond'],
			[P2, 1, 'high', 'bond'],
			[P2, 1, 'high', 'bond']
		]);
	});

	it('a listed provider says nothing about the node it bonded to', () => {
		const provider: IndexEntry = { key: `thor:${P1}`, hop: 0, originRisk: 'severe', originKey: `thor:${P1}`, originSource: 'ofac_sdn', originCategory: 'sanctions' };
		expect(nodeHistory().flatMap((a) => traceAction(a, (k) => (k === provider.key ? provider : undefined), prices))).toEqual([]);
	});

	describe('in the backfill', async () => {
		const { db, sql } = await memoryDb();
		afterAll(() => db.close());

		it('reads the listed node and flags both bond addresses (the post-mortem\'s ~635,000 RUNE)', async () => {
			const res = emptyResult();
			res.entries = [
				{ source: 'curated', key: `thor:${NODE}`, chain: 'THOR', address: NODE, category: 'hack', risk: 'severe', code: 'INCIDENT_EXPLOITER', text: 'malicious validator', entity: listedNode.originEntity }
			];
			await applySourceResult(sql, { id: 'curated', name: 'curated', kind: 'curated' }, res);
			const all = nodeHistory();
			// Midgard's address filter also matches the node named in a bond's metadata
			const fake = new FakeMidgard(all);
			const midgard: MidgardLike = {
				actions: fake.actions.bind(fake),
				actionsSince: fake.actionsSince.bind(fake),
				pools: fake.pools.bind(fake),
				runePriceUsd: fake.runePriceUsd.bind(fake),
				async *actionsForAddress(address: string) {
					for (const a of [...all].reverse()) {
						if ([...a.in, ...a.out].some((t) => t.address === address) || a.metadata?.bond?.nodeAddress === address) yield a;
					}
				}
			};
			const r = await runTraceBackfill(sql, midgard as never, { prices });
			expect(r.errors).toBe(0);
			const traced = await sql.query<{ key: string; hop: number; risk: string }>(`SELECT key, hop, risk FROM oz_traced ORDER BY key`);
			expect(traced.rows).toEqual([
				{ key: `thor:${P1}`, hop: 1, risk: 'high' },
				{ key: `thor:${P2}`, hop: 1, risk: 'high' }
			]);
			const reason = await sql.query<{ reason: string }>(`SELECT reason FROM oz_trace_edges WHERE to_key = $1 AND relation = 'bond'`, [`thor:${P1}`]);
			expect(reason.rows[0].reason).toMatch(new RegExp(`^is a bond provider of the THORChain node ${NODE}, listed by THORChain vault exploit .*: bonded 139472.6194 THOR.RUNE to it in THORChain bond`));
		});
	});
});

describe('fee collectors and the service rule', () => {
	const A = 'thor148sahwr5pg44cy0n23zwc723ugy2fptw0m8sau'; // an interface's fee collector (naswap)
	const B = 'thor1a427q3v96psuj4fnughdw8glt5r7j38lj7rkp8';
	// six swaps of other people that pay A an affiliate fee, and A's own payment to B
	const history = (): MidgardAction[] => [
		...Array.from({ length: 6 }, (_, i) =>
			action({
				height: 100 + i,
				in: [{ address: `0x${String(i + 1).padStart(40, '0')}`, asset: 'ETH.ETH', amount: 1 }],
				out: [
					{ address: `0x${String(i + 1).padStart(40, '0')}`.replace('0x0', '0x9'), asset: 'ETH.ETH', amount: 0.99 },
					{ address: A, asset: 'THOR.RUNE', amount: 1, affiliate: true }
				],
				metadata: { swap: { affiliateAddress: A, affiliateFee: '10', memo: `=:e:x:0:${A}:10` } }
			})
		),
		action({ type: 'send', height: 200, in: [{ address: A, asset: 'THOR.RUNE', amount: 20_000 }], out: [{ address: B, asset: 'THOR.RUNE', amount: 20_000 }] })
	];
	const entry = (hop: number): IndexEntry => ({ key: `thor:${A}`, hop, originRisk: 'high', originKey: 'evm:0x' + 'e'.repeat(40), originSource: 'cluster', originCategory: 'hack' });

	it('fees do not exempt an account flagged high in its own right (a hop-1 recipient): its payments are followed', async () => {
		const e = entry(1);
		const r = await checkAddress(new FakeMidgard(history()) as never, e.key, 0, (k) => (k === e.key ? e : undefined), prices, DEFAULT_TRACE_CONFIG);
		expect(r.affiliateFees).toBe(6);
		expect(r.service).toBe(false);
		expect(r.hits.map((h) => h.toAddress)).toEqual([B]);
	});

	it('a collector below high is a service, and passes nothing on — also not from the check that found it', async () => {
		const e = entry(2);
		const r = await checkAddress(new FakeMidgard(history()) as never, e.key, 0, (k) => (k === e.key ? e : undefined), prices, DEFAULT_TRACE_CONFIG);
		expect(r.service).toBe(true);
		expect(r.hits).toEqual([]);
	});

	describe('in the index', async () => {
		const { db, sql } = await memoryDb();
		afterAll(() => db.close());

		it('a known collector is a service there only below high', async () => {
			const hit = (to: string, hop: number, risk: TraceHit['risk']): TraceHit => ({
				txid: `T${to.slice(-4)}${hop}`,
				height: 10 + hop,
				date: '2026-04-01T00:00:00.000Z',
				action: 'send',
				relation: 'value',
				fromKey: 'evm:0x' + 'e'.repeat(40),
				fromAddress: '0x' + 'e'.repeat(40),
				fromChain: 'ETH',
				toKey: `thor:${to}`,
				toAddress: to,
				toChain: 'THOR',
				amount: '5000 THOR.RUNE',
				usd: 7_500,
				hop,
				risk,
				originKey: 'evm:0x' + 'e'.repeat(40),
				originSource: 'cluster',
				originRisk: 'high',
				originCategory: 'hack'
			});
			await recordHits(sql, [hit(A, 1, 'high'), hit(B, 2, 'medium')]);
			await sql.query(`INSERT INTO oz_affiliates (address, receipts) VALUES ($1, 40), ($2, 40)`, [A, B]);
			const index = await loadTraceIndex(sql);
			expect(index.get(`thor:${A}`)?.service).toBeFalsy();
			expect(index.get(`thor:${B}`)?.service).toBe(true);
		});
	});
});

describe('re-reading only the thor1 histories once (pass G)', async () => {
	const { db, sql } = await memoryDb();
	afterAll(() => db.close());

	it('resets the thor: checks once per label, nothing else, and leaves the owner\'s switch alone', async () => {
		await sql.query(
			`INSERT INTO oz_trace_checked (key, checked_height, status) VALUES ('thor:thor1x', 500, 'done'), ('thor:thor1s', 500, 'service'), ('evm:0xabc', 500, 'done')`
		);
		const once = await maybeResetBackfill(sql, 'pass-g', undefined, { keyPrefix: 'thor:', stateId: 'backfill:reset-thor' });
		expect(once).toEqual({ applied: true, reset: 1 });
		const rows = await sql.query<{ key: string; status: string; checked_height: string }>(`SELECT key, status, checked_height FROM oz_trace_checked ORDER BY key`);
		expect(rows.rows.map((r) => [r.key, r.status, Number(r.checked_height)])).toEqual([
			['evm:0xabc', 'done', 500],
			['thor:thor1s', 'service', 500],
			['thor:thor1x', 'pending', 0]
		]);
		expect(await maybeResetBackfill(sql, 'pass-g', undefined, { keyPrefix: 'thor:', stateId: 'backfill:reset-thor' })).toEqual({ applied: false, reset: 0 });
		expect(await getState(sql, 'backfill:reset')).toBeUndefined();
	});
});
