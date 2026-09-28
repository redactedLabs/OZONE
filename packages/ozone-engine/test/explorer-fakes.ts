/**
 * In-memory explorers for tests — no request ever leaves the process:
 *
 * - an Etherscan-compatible API (routescan's shape: no `filter_by`, both
 *   directions returned) where a block number is its unix time;
 * - the public JSON-RPC eth_getCode (batched) for contract detection;
 * - THORNode /thorchain/inbound_addresses;
 * - an Esplora REST API (address stats, 25-per-page history, transactions).
 */
import { configureHost, resetHostBudgets, resetThorchainInboundCache, type EsploraTx } from '../src/index.js';

export interface FakeTx {
	from: string;
	to: string;
	/** In ether. */
	eth: number;
	/** Unix time (= block number here). */
	time: number;
	hash?: string;
	input?: string;
	isError?: boolean;
}

export interface FakeTokenTx {
	token: string;
	from: string;
	to: string;
	amount: number;
	decimals?: number;
	symbol?: string;
	time: number;
	hash?: string;
}

export interface FakeEvm {
	txs: FakeTx[];
	tokenTxs?: FakeTokenTx[];
	contracts?: string[];
	/** eth_getCode fails (the RPC is down). */
	rpcDown?: boolean;
	/** The explorer answers "rate limit" to every call. */
	rateLimited?: boolean;
	/** Every request URL (for assertions). */
	log?: string[];
}

let n = 0;
const hash = () => `0x${(++n).toString(16).padStart(64, '0')}`;
const wei = (eth: number) => (BigInt(Math.round(eth * 1e6)) * 10n ** 12n).toString();

/** Fast budgets for every host the engine uses, and no cached vault list. */
export function fastHosts(): void {
	resetHostBudgets();
	resetThorchainInboundCache();
	for (const h of [
		'api.routescan.io',
		'eth.blockscout.com',
		'arbitrum.blockscout.com',
		'optimism.blockscout.com',
		'base.blockscout.com',
		'polygon.blockscout.com',
		'gnosis.blockscout.com',
		'api.etherscan.io',
		'api.blockscout.com',
		'ethereum-rpc.publicnode.com',
		'base-rpc.publicnode.com',
		'bsc-rpc.publicnode.com',
		'avalanche-c-chain-rpc.publicnode.com'
	]) {
		configureHost(h, { minIntervalMs: 0 });
	}
}

export function fakeExplorers(evm: FakeEvm, esplora?: FakeEsplora): typeof fetch {
	for (const t of evm.txs) t.hash ??= hash();
	for (const t of evm.tokenTxs ?? []) t.hash ??= hash();
	const contracts = new Set((evm.contracts ?? []).map((c) => c.toLowerCase()));
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		evm.log?.push(`${url.host}${url.pathname}${url.search}`);
		const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		if (url.pathname.endsWith('/thorchain/inbound_addresses')) return json([]);
		if (url.host.endsWith('publicnode.com')) {
			if (evm.rpcDown) return new Response('down', { status: 503 });
			const calls = JSON.parse(String(init?.body ?? '[]')) as Array<{ id: number; params: [string] }>;
			return json(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: contracts.has(c.params[0].toLowerCase()) ? '0x6080604052' : '0x' })));
		}
		if (esplora && url.host === 'esplora.test') return esplora.answer(url);
		if (url.pathname.endsWith('/api')) {
			if (evm.rateLimited) return json({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
			const p = url.searchParams;
			const action = p.get('action');
			if (action === 'getblocknobytime') return json({ status: '1', message: 'OK', result: p.get('timestamp') });
			const address = (p.get('address') ?? '').toLowerCase();
			const start = Number(p.get('startblock') ?? 0);
			const end = Number(p.get('endblock') ?? 999_999_999);
			const page = Number(p.get('page') ?? 1);
			const offset = Number(p.get('offset') ?? 1000);
			const desc = p.get('sort') === 'desc';
			if (action === 'txlist') {
				const list = evm.txs
					.filter((t) => (t.from.toLowerCase() === address || t.to.toLowerCase() === address) && t.time >= start && t.time <= end)
					.sort((a, b) => (desc ? b.time - a.time : a.time - b.time))
					.slice((page - 1) * offset, page * offset)
					.map((t) => ({
						blockNumber: String(t.time),
						timeStamp: String(t.time),
						hash: t.hash,
						from: t.from.toLowerCase(),
						to: t.to.toLowerCase(),
						value: wei(t.eth),
						input: t.input ?? '0x',
						isError: t.isError ? '1' : '0'
					}));
				return json(list.length ? { status: '1', message: 'OK', result: list } : { status: '0', message: 'No transactions found', result: [] });
			}
			if (action === 'tokentx') {
				const token = (p.get('contractaddress') ?? '').toLowerCase();
				const list = (evm.tokenTxs ?? [])
					.filter((t) => t.token.toLowerCase() === token && (t.from.toLowerCase() === address || t.to.toLowerCase() === address))
					.sort((a, b) => (desc ? b.time - a.time : a.time - b.time))
					.slice((page - 1) * offset, page * offset)
					.map((t) => ({
						timeStamp: String(t.time),
						hash: t.hash,
						from: t.from.toLowerCase(),
						to: t.to.toLowerCase(),
						value: (BigInt(Math.round(t.amount * 1e6)) * 10n ** BigInt((t.decimals ?? 6) - 6)).toString(),
						tokenDecimal: String(t.decimals ?? 6),
						tokenSymbol: t.symbol ?? 'USDT'
					}));
				return json(list.length ? { status: '1', message: 'OK', result: list } : { status: '0', message: 'No transactions found', result: [] });
			}
		}
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
}

/** A tiny Esplora: transactions by id, address stats and history. */
export class FakeEsplora {
	readonly txs = new Map<string, EsploraTx>();
	constructor(
		list: EsploraTx[],
		private readonly txCounts: Record<string, number> = {}
	) {
		for (const t of list) this.txs.set(t.txid, t);
	}

	private involving(address: string): EsploraTx[] {
		return [...this.txs.values()]
			.filter((t) => t.vin.some((v) => v.prevout?.scriptpubkey_address === address) || t.vout.some((o) => o.scriptpubkey_address === address))
			.sort((a, b) => (b.status.block_time ?? 0) - (a.status.block_time ?? 0));
	}

	answer(url: URL): Response {
		const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
		const parts = url.pathname.replace(/^\/api/, '').split('/').filter(Boolean);
		if (parts[0] === 'tx') {
			const t = this.txs.get(parts[1]);
			return t ? json(t) : new Response('not found', { status: 404 });
		}
		if (parts[0] === 'address' && parts.length === 2) {
			return json({ address: parts[1], chain_stats: { tx_count: this.txCounts[parts[1]] ?? this.involving(parts[1]).length, funded_txo_sum: 0, spent_txo_sum: 0 } });
		}
		if (parts[0] === 'address' && parts[2] === 'txs') {
			const all = this.involving(parts[1]);
			const after = parts[4];
			const startAt = after ? all.findIndex((t) => t.txid === after) + 1 : 0;
			return json(all.slice(startAt, startAt + 25));
		}
		return new Response('not found', { status: 404 });
	}
}

/** A UTXO transaction: inputs are [address, sats, fundingTxid], outputs [address | {opReturn}, sats]. */
export function utxoTx(txid: string, time: number, vin: Array<[string, number, string?]>, vout: Array<[string | { opReturn: string }, number]>): EsploraTx {
	return {
		txid,
		vin: vin.map(([a, v, f], i) => ({ txid: f ?? `${txid}-in${i}`, vout: 0, prevout: { scriptpubkey_address: a, value: v } })),
		vout: vout.map(([o, v]) =>
			typeof o === 'string'
				? { scriptpubkey_address: o, scriptpubkey_type: 'v0_p2wpkh', value: v }
				: { scriptpubkey_type: 'op_return', scriptpubkey: `6a${Buffer.from(o.opReturn).length.toString(16).padStart(2, '0')}${Buffer.from(o.opReturn).toString('hex')}`, value: 0 }
		),
		status: { confirmed: true, block_height: time, block_time: time }
	};
}
