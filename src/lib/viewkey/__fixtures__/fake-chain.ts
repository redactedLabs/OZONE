/**
 * Test stand-ins for the network of the view-key page: two CometBFT RPCs serving the proxy of
 * view-fixture.json (its feed records through `abci_query`, as the proxy pages them), the transactions
 * that executed it and the Spending account (`tx_search`) and the listed addresses' balances, and Ozone's `POST /api/v1/screen`. Every request is
 * recorded, so a test can check what left the page.
 */
import fixture from './view-fixture.json';
import historyFixture from './history-fixture.json';
import { CHAIN_SOURCES } from '../config';

export { fixture, historyFixture };

/** What the fake network serves: either fixture's chain (feeds at a tip, transactions, blocks, balances). */
export interface ChainFixture {
	deployment: { chain_id: string; proxy: string };
	height: number;
	feeds: { height: number; [feed: string]: unknown };
	denoms: string[];
	txs: Record<string, { height: string }[]>;
	blocks: Record<string, string>;
	balances: Record<string, { denom: string; amount: string }[]>;
}

export interface Call {
	url: string;
	method: string;
	body: string | null;
	headers: Record<string, string>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function varint(n: number): number[] {
	const out: number[] = [];
	while (n >= 0x80) {
		out.push((n & 0x7f) | 0x80);
		n >>>= 7;
	}
	out.push(n);
	return out;
}
const lenField = (no: number, b: Uint8Array) => [(no << 3) | 2, ...varint(b.length), ...b];
function fields(buf: Uint8Array): Map<number, Uint8Array[]> {
	const out = new Map<number, Uint8Array[]>();
	let i = 0;
	const rv = () => {
		let s = 0,
			v = 0;
		for (;;) {
			const b = buf[i++]!;
			v += (b & 0x7f) * 2 ** s;
			if (!(b & 0x80)) return v;
			s += 7;
		}
	};
	while (i < buf.length) {
		const key = rv();
		const no = key >> 3;
		const len = rv();
		out.set(no, [...(out.get(no) ?? []), buf.subarray(i, i + len)]);
		i += len;
	}
	return out;
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));

type Records = ChainFixture['feeds'];
type Rec = Record<string, unknown>;

const LISTS: Record<string, { key: keyof Records; list: string; cursor: (r: Rec) => string | number; numeric: boolean }> = {
	notes: { key: 'notes', list: 'notes', cursor: (r) => r.index as number, numeric: true },
	nullifiers: { key: 'nullifiers', list: 'nullifiers', cursor: (r) => (r.record as Rec).sequence as number, numeric: true },
	pending_deposits: { key: 'deposits', list: 'pending', cursor: (r) => r.id as number, numeric: true },
	accounts: { key: 'accounts', list: 'accounts', cursor: (r) => r.address as string, numeric: false },
	headers: { key: 'headers', list: 'headers', cursor: (r) => r.tau as string, numeric: false },
	slows: { key: 'slow', list: 'requests', cursor: (r) => r.nf as string, numeric: false },
	queue: { key: 'queue', list: 'items', cursor: (r) => (r.seq as number) ?? (r.id as number), numeric: true }
};

/** What the fake proxy answers to one smart query. */
function proxyAnswer(fx: ChainFixture, feeds: Records, q: Rec): unknown {
	const [name, args] = Object.entries(q)[0] as [string, Rec];
	if (name === 'denoms') return { denoms: fx.denoms.map((denom) => ({ config: { denom, enabled: true, ceiling: '0', min_deposit: '0', floors: {} }, pending: null })) };
	const spec = LISTS[name];
	if (!spec) throw new Error(`unknown query ${name}`);
	let all = (feeds[spec.key] as Rec[]).slice();
	if (name === 'queue') all = all.filter((r) => r.denom === args.denom);
	const after = args.start_after;
	if (after !== null && after !== undefined) all = all.filter((r) => (spec.numeric ? Number(spec.cursor(r)) > Number(after) : String(spec.cursor(r)) > String(after)));
	return { [spec.list]: all.slice(0, Number(args.limit)) };
}

export interface FakeOptions {
	/** The chain to serve (default: the view-key fixture's). */
	fx?: ChainFixture;
	/** Source B serves this block hash at every height (a source on another chain, or a lying one). */
	blockHashB?: string;
	/** Source B answers this instead (a lying or lagging source). */
	feedsB?: Records;
	tipB?: number;
	networkB?: string;
	/** Which addresses Ozone flags, with a reason. */
	flagged?: Record<string, string>;
	/** Ozone has no snapshot (503). */
	screenDown?: boolean;
}

export function fakeNetwork(opts: FakeOptions = {}) {
	const fx: ChainFixture = opts.fx ?? (fixture as unknown as ChainFixture);
	const calls: Call[] = [];
	const [A, B] = CHAIN_SOURCES;
	const tip = (i: number) => (i === 1 && opts.tipB !== undefined ? opts.tipB : fx.height);
	const feeds = (i: number) => (i === 1 && opts.feedsB ? opts.feedsB : fx.feeds);
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

	const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = String(input instanceof Request ? input.url : input);
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
		calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : init?.body ? '[non-string body]' : null, headers });
		if (url === '/api/v1/screen' || url.endsWith('/api/v1/screen')) {
			if (opts.screenDown) return json({ error: 'Screening data unavailable' }, 503);
			const { addresses } = JSON.parse(String(init?.body)) as { addresses: string[] };
			const results = addresses.map((a) => {
				const why = opts.flagged?.[a];
				return {
					input: a,
					keys: [a],
					valid: true,
					status: why ? 'flagged' : 'clean',
					risk: why ? 'severe' : 'none',
					reasons: why ? [{ code: 'TEST', source: 'test-list', category: 'manual', risk: 'severe', text: why }] : []
				};
			});
			return json({ type: 'ozone.screen.v1', id: 'x', issuedAt: '2026-10-24T00:00:00Z', policy: { flagAt: 'high' }, snapshot: { version: 7, builtAt: '2026-10-24T00:00:00.000Z', sha256: '00' }, results, signature: { alg: 'ed25519', keyId: 'k', sig: 's' } });
		}
		const i = url.startsWith(A.rpc + '/') ? 0 : url.startsWith(B.rpc + '/') ? 1 : -1;
		if (i < 0) return new Response('not here', { status: 404 });
		const u = new URL(url);
		const path = u.pathname.slice(new URL((i === 0 ? A : B).rpc).pathname.replace(/\/$/, '').length);
		if (path === '/status') {
			return json({ jsonrpc: '2.0', id: -1, result: { node_info: { network: i === 1 && opts.networkB ? opts.networkB : fx.deployment.chain_id }, sync_info: { latest_block_height: String(tip(i)), catching_up: false } } });
		}
		if (path === '/blockchain') {
			const lo = Number(u.searchParams.get('minHeight'));
			const hi = Number(u.searchParams.get('maxHeight'));
			const metas = [];
			for (let h = hi; h >= lo; h--) {
				const hash = i === 1 && opts.blockHashB ? opts.blockHashB : fx.blocks[String(h)];
				if (hash && h <= tip(i)) metas.push({ block_id: { hash, parts: { total: 1, hash: '00' } }, header: { height: String(h), chain_id: fx.deployment.chain_id } });
			}
			return json({ jsonrpc: '2.0', id: -1, result: { last_height: String(tip(i)), block_metas: metas } });
		}
		if (path === '/tx_search') {
			const q = JSON.parse(u.searchParams.get('query')!) as string;
			const m = /^execute\._contract_address='([a-z0-9]+)' AND tx\.height>=(\d+) AND tx\.height<=(\d+)$/.exec(q);
			if (!m) return json({ jsonrpc: '2.0', id: -1, error: { code: -32603, message: 'Internal error', data: 'query not indexed' } });
			const all = (fx.txs[m[1]!] ?? []).filter((t) => Number(t.height) >= Number(m[2]) && Number(t.height) <= Number(m[3]));
			const per = Number(u.searchParams.get('per_page'));
			const page = Number(u.searchParams.get('page'));
			return json({ jsonrpc: '2.0', id: -1, result: { txs: all.slice((page - 1) * per, page * per), total_count: String(all.length) } });
		}
		if (path === '/abci_query') {
			const qpath = JSON.parse(u.searchParams.get('path')!);
			const height = Number(u.searchParams.get('height'));
			if (height > tip(i)) return json({ jsonrpc: '2.0', id: -1, result: { response: { code: 26, log: 'height in the future' } } });
			const req = fields(hexToBytes(u.searchParams.get('data')!.slice(2)));
			const address = dec.decode(req.get(1)![0]!);
			let value: Uint8Array;
			if (qpath === '/cosmwasm.wasm.v1.Query/SmartContractState') {
				if (address !== fx.deployment.proxy) return json({ jsonrpc: '2.0', id: -1, result: { response: { code: 5, log: 'no such contract' } } });
				const q = JSON.parse(dec.decode(req.get(2)![0]!));
				value = Uint8Array.from(lenField(1, enc.encode(JSON.stringify(proxyAnswer(fx, feeds(i), q)))));
			} else if (qpath === '/cosmos.bank.v1beta1.Query/AllBalances') {
				const coins = fx.balances[address] ?? [];
				value = Uint8Array.from(coins.flatMap((c) => lenField(1, Uint8Array.from([...lenField(1, enc.encode(c.denom)), ...lenField(2, enc.encode(c.amount))]))));
			} else return json({ jsonrpc: '2.0', id: -1, result: { response: { code: 6, log: 'unknown path' } } });
			return json({ jsonrpc: '2.0', id: -1, result: { response: { code: 0, height: String(height), value: b64(value) } } });
		}
		return new Response('not here', { status: 404 });
	};
	return { calls, fetchFn: fetchFn as typeof fetch };
}
