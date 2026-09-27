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

/**
 * A `fetch` that answers Midgard's /v2/actions the way the real one does
 * (measured against the public gateway, 2026-09-27): every page sorted
 * newest first; no cursor → the newest `limit`; `fromHeight=H` (inclusive)
 * → the `limit` OLDEST actions at or after H; `nextPageToken` → older than
 * the token, `prevPageToken` → newer than it (the next `limit` in chain
 * order); `address=` matches any in/out address exactly; `txid=` any txID.
 * Tokens are positions (height and index within the height).
 */
export function midgardFetch(all: MidgardAction[], log: string[] = []): typeof fetch {
	const pos = new Map<MidgardAction, number>();
	const perHeight = new Map<number, number>();
	for (const a of [...all].sort((x, y) => Number(x.height) - Number(y.height))) {
		const h = Number(a.height);
		const i = perHeight.get(h) ?? 0;
		perHeight.set(h, i + 1);
		pos.set(a, h * 10_000 + i);
	}
	const asc = [...all].sort((x, y) => pos.get(x)! - pos.get(y)!);
	return (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		log.push(url.search);
		if (!url.pathname.endsWith('/v2/actions')) return new Response('not found', { status: 404 });
		const p = url.searchParams;
		const limit = Number(p.get('limit') ?? 50);
		let list = asc;
		const address = p.get('address');
		if (address) list = list.filter((a) => [...a.in, ...a.out].some((t) => t.address === address));
		const txid = p.get('txid');
		if (txid) list = list.filter((a) => [...a.in, ...a.out].some((t) => t.txID === txid));
		let page: MidgardAction[];
		if (p.get('prevPageToken')) {
			const t = Number(p.get('prevPageToken'));
			page = list.filter((a) => pos.get(a)! > t).slice(0, limit);
		} else if (p.get('nextPageToken')) {
			const t = Number(p.get('nextPageToken'));
			const floor = Number(p.get('fromHeight') ?? 0);
			page = list.filter((a) => pos.get(a)! < t && Number(a.height) >= floor).slice(-limit);
		} else if (p.get('fromHeight')) {
			const h = Number(p.get('fromHeight'));
			page = list.filter((a) => Number(a.height) >= h).slice(0, limit);
		} else {
			page = list.slice(-limit);
		}
		const desc = [...page].reverse();
		const meta = desc.length
			? { nextPageToken: String(pos.get(desc[desc.length - 1])), prevPageToken: String(pos.get(desc[0])) }
			: { nextPageToken: '', prevPageToken: '' };
		return new Response(JSON.stringify({ actions: desc, meta }), { status: 200, headers: { 'content-type': 'application/json' } });
	}) as typeof fetch;
}
