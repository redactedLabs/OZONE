import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/store/db.js';
import type { MidgardAction, MidgardLike } from '../src/trace/midgard.js';
import type { Sql } from '../src/types.js';

export async function memoryDb(): Promise<{ db: PGlite; sql: Sql }> {
	const db = await PGlite.create();
	const sql = db as unknown as Sql;
	await migrate(sql, { baseline: true });
	return { db, sql };
}

let seq = 0;
export function action(p: {
	type?: string;
	height: number;
	date?: string;
	status?: string;
	in: Array<{ address: string; asset: string; amount: number; txID?: string }>;
	out?: Array<{ address: string; asset: string; amount: number; affiliate?: boolean }>;
	metadata?: MidgardAction['metadata'];
}): MidgardAction {
	seq++;
	const date = p.date ? BigInt(Date.parse(p.date)) * 1_000_000n : BigInt(1_740_000_000_000 + p.height * 6000) * 1_000_000n;
	return {
		date: date.toString(),
		height: String(p.height),
		status: p.status ?? 'success',
		type: p.type ?? 'swap',
		pools: [],
		in: p.in.map((i) => ({
			address: i.address,
			coins: [{ asset: i.asset, amount: String(Math.round(i.amount * 1e8)) }],
			txID: i.txID ?? `TX${String(seq).padStart(6, '0')}${p.height}`
		})),
		out: (p.out ?? []).map((o) => ({
			address: o.address,
			coins: [{ asset: o.asset, amount: String(Math.round(o.amount * 1e8)) }],
			txID: '',
			...(o.affiliate ? { affiliate: true } : {})
		})),
		metadata: p.metadata ?? {}
	};
}

/**
 * In-memory Midgard: answers `actionsForAddress` case-sensitively (like the
 * real one) and `actionsSince` from a list.
 */
export class FakeMidgard implements MidgardLike {
	requests: string[] = [];
	constructor(
		private readonly all: MidgardAction[],
		private readonly prices: Record<string, number> = {}
	) {}

	async actions(): Promise<{ actions: MidgardAction[]; nextPageToken?: string }> {
		const sorted = [...this.all].sort((a, b) => Number(b.height) - Number(a.height));
		return { actions: sorted.slice(0, 1) };
	}

	async *actionsForAddress(address: string, opts: { fromHeight?: number } = {}): AsyncGenerator<MidgardAction> {
		this.requests.push(address);
		const hits = this.all
			.filter((a) => [...a.in, ...a.out].some((t) => t.address === address))
			.filter((a) => !opts.fromHeight || Number(a.height) > opts.fromHeight)
			.sort((a, b) => Number(b.height) - Number(a.height));
		for (const a of hits) yield a;
	}

	async actionsSince(afterHeight: number): Promise<{ actions: MidgardAction[]; complete: boolean; head: number }> {
		const newer = this.all.filter((a) => Number(a.height) > afterHeight).sort((a, b) => Number(a.height) - Number(b.height));
		const head = Math.max(afterHeight, ...this.all.map((a) => Number(a.height)));
		return { actions: newer, complete: true, head };
	}

	async pools() {
		return Object.entries(this.prices)
			.filter(([k]) => k !== 'THOR.RUNE')
			.map(([asset, p]) => ({ asset, assetPriceUSD: String(p), status: 'available' }));
	}

	async runePriceUsd() {
		return this.prices['THOR.RUNE'] ?? 0;
	}
}
