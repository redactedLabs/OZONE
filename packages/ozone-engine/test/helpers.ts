import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/store/db.js';
import { TX_PAGE_SIZE, WASM_EXECUTE, type ChainEvent, type ChainLike, type ChainRead, type ChainTx, type WasmTxQuery } from '../src/trace/chain.js';
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

// ---------------------------------------------------------------------------
// Chain transactions (trace/chain.ts)
// ---------------------------------------------------------------------------

export interface ChainMsgSpec {
	/** The message's signer (MsgExecuteContract sender). */
	signer: string;
	/** Bank transfers the message caused: [sender, recipient, "123rune,45btc-btc"]. */
	transfers?: Array<[string, string, string]>;
	/** Contract events: `wasm-<type>` with their attributes. */
	wasm?: Array<{ type: string; attrs: Record<string, string> }>;
}

let txSeq = 0;
/** A chain transaction with the events the LCD reports for the given messages (msg_index on every event). */
export function chainTx(p: { height: number; hash?: string; date?: string; code?: number; msgs: ChainMsgSpec[] }): ChainTx {
	txSeq++;
	const events: ChainEvent[] = [{ type: 'tx', attributes: [{ key: 'fee', value: '0rune' }, { key: 'fee_payer', value: p.msgs[0]?.signer ?? '' }] }];
	p.msgs.forEach((m, i) => {
		const idx = String(i);
		events.push({ type: 'message', attributes: [{ key: 'action', value: WASM_EXECUTE }, { key: 'sender', value: m.signer }, { key: 'module', value: 'wasm' }, { key: 'msg_index', value: idx }] });
		for (const [sender, recipient, amount] of m.transfers ?? []) {
			events.push({ type: 'transfer', attributes: [{ key: 'recipient', value: recipient }, { key: 'sender', value: sender }, { key: 'amount', value: amount }, { key: 'msg_index', value: idx }] });
		}
		for (const w of m.wasm ?? []) {
			events.push({ type: `wasm-${w.type}`, attributes: [...Object.entries(w.attrs).map(([key, value]) => ({ key, value })), { key: 'msg_index', value: idx }] });
		}
	});
	return {
		hash: p.hash ?? `CHAINTX${String(txSeq).padStart(6, '0')}`,
		height: p.height,
		date: p.date ?? new Date(1_740_000_000_000 + p.height * 6000).toISOString(),
		code: p.code ?? 0,
		events
	};
}

/** The signers of a transaction's messages. */
const signersOf = (tx: ChainTx) => tx.events.filter((e) => e.type === 'message').map((e) => e.attributes.find((a) => a.key === 'sender')?.value);

/** In-memory THORNode: the LCD's search (oldest first, paged like the real one) over a list of contract transactions. */
export class FakeChain implements ChainLike {
	requests = 0;
	/** Heights the pages were read at, in order (to check that a read resumed instead of starting over). */
	readonly reads: Array<{ signer?: string; from: number; to?: number }> = [];
	constructor(
		readonly txs: ChainTx[],
		public head = Math.max(0, ...txs.map((t) => t.height))
	) {}

	async latestHeight(): Promise<number> {
		this.requests++;
		return this.head;
	}

	async *wasmTxs(q: WasmTxQuery): AsyncGenerator<ChainTx> {
		this.reads.push({ signer: q.signer, from: q.fromHeight, to: q.toHeight });
		const all = this.txs
			.filter((t) => t.height >= q.fromHeight && (q.toHeight === undefined || t.height <= q.toHeight) && (!q.signer || signersOf(t).includes(q.signer)))
			.sort((a, b) => a.height - b.height);
		const maxPages = Math.max(1, q.maxPages ?? 40);
		const progress: ChainRead | undefined = q.progress;
		for (let page = 0; ; page++) {
			this.requests++;
			const rows = all.slice(page * TX_PAGE_SIZE, (page + 1) * TX_PAGE_SIZE);
			for (const t of rows) yield t;
			if (rows.length < TX_PAGE_SIZE || (page + 1) * TX_PAGE_SIZE >= all.length) {
				if (progress) {
					progress.complete = true;
					delete progress.resumeHeight;
				}
				return;
			}
			if (page + 1 >= maxPages || (q.deadline !== undefined && Date.now() > q.deadline)) {
				if (progress) {
					progress.complete = false;
					progress.resumeHeight = rows[rows.length - 1].height;
				}
				return;
			}
		}
	}
}
