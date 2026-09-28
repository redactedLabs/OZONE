/**
 * Esplora REST APIs (keyless) for Bitcoin and Litecoin: mempool.space and
 * blockstream.info for BTC, litecoinspace.org for LTC. None publishes its
 * limits (mempool.space answers 429 and bans repeated offenders), so every
 * host is paced strictly (one request at a time, 1.5–2 s apart), a host
 * that answers 429 is left alone for 15 minutes and the next one is tried,
 * and immutable answers (transactions, confirmed history pages) are cached
 * for the life of the process.
 */
import { httpJson, HttpError, type HttpOptions } from '../util/http.js';
import { hostBudget, QuotaExceeded, type HostBudget } from './budget.js';

export type UtxoChain = 'BTC' | 'LTC';

export const UTXO_CHAINS: readonly UtxoChain[] = ['BTC', 'LTC'];

export function isUtxoChain(chain: string): chain is UtxoChain {
	return (UTXO_CHAINS as readonly string[]).includes(chain);
}

const HOSTS: Record<UtxoChain, Array<{ base: string; minIntervalMs: number }>> = {
	BTC: [
		{ base: 'https://mempool.space/api', minIntervalMs: 1_500 },
		{ base: 'https://blockstream.info/api', minIntervalMs: 1_500 }
	],
	LTC: [{ base: 'https://litecoinspace.org/api', minIntervalMs: 2_000 }]
};

export interface EsploraPrevout {
	scriptpubkey_address?: string;
	scriptpubkey_type?: string;
	value: number;
}

export interface EsploraTx {
	txid: string;
	vin: Array<{ txid: string; vout: number; is_coinbase?: boolean; prevout?: EsploraPrevout | null }>;
	vout: Array<{ scriptpubkey?: string; scriptpubkey_asm?: string; scriptpubkey_type?: string; scriptpubkey_address?: string; value: number }>;
	status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export interface EsploraAddress {
	address: string;
	chain_stats: { tx_count: number; funded_txo_sum: number; spent_txo_sum: number };
	mempool_stats?: { tx_count: number };
}

export class Esplora {
	private readonly hosts: Array<{ base: string; budget: HostBudget }>;
	private readonly cache = new Map<string, unknown>();
	requests = 0;

	constructor(
		readonly chain: UtxoChain,
		private readonly opts: { http?: HttpOptions; hosts?: string[]; cacheSize?: number } = {}
	) {
		const list = opts.hosts ? opts.hosts.map((base) => ({ base, minIntervalMs: 0 })) : HOSTS[chain];
		this.hosts = list.map((h) => ({ base: h.base.replace(/\/+$/, ''), budget: hostBudget(new URL(h.base).host, { minIntervalMs: h.minIntervalMs }) }));
	}

	/** Requests any host could send now. */
	capacity(): number {
		return this.hosts.reduce((n, h) => n + h.budget.remaining(), 0);
	}

	private remember(key: string, value: unknown) {
		if (this.cache.size >= (this.opts.cacheSize ?? 20_000)) this.cache.delete(this.cache.keys().next().value as string);
		this.cache.set(key, value);
	}

	/** GET `path` on the first host that answers; `cache` keeps the answer (immutable data only). */
	async get<T>(path: string, cache = false): Promise<T> {
		if (cache && this.cache.has(path)) return this.cache.get(path) as T;
		let last: unknown;
		for (const h of this.hosts) {
			try {
				const body = await h.budget.run(() => httpJson<T>(`${h.base}${path}`, { timeoutMs: 45_000, retries: 1, ...this.opts.http }));
				this.requests++;
				if (cache) this.remember(path, body);
				return body;
			} catch (e) {
				last = e;
				if (e instanceof HttpError && e.status === 429) h.budget.block(Date.now() + 15 * 60_000);
				if (e instanceof HttpError && e.status === 400) throw e; // bad address/txid: no other host will like it better
			}
		}
		if (last instanceof QuotaExceeded) throw last;
		throw last instanceof Error ? last : new Error(`${this.chain}: no Esplora host answered`);
	}

	address(address: string): Promise<EsploraAddress> {
		return this.get<EsploraAddress>(`/address/${encodeURIComponent(address)}`);
	}

	tx(txid: string): Promise<EsploraTx> {
		return this.get<EsploraTx>(`/tx/${encodeURIComponent(txid)}`, true);
	}

	/**
	 * Confirmed transactions of `address` with a block time inside
	 * [fromUnix, toUnix], newest first, at most `maxPages` pages of 25.
	 * `more` tells whether older transactions inside the window were left
	 * unread because of the page limit.
	 */
	async txsInWindow(address: string, fromUnix: number, toUnix: number, maxPages: number): Promise<{ txs: EsploraTx[]; pages: number; more: boolean }> {
		const out: EsploraTx[] = [];
		let last: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			const path = `/address/${encodeURIComponent(address)}/txs/chain${last ? `/${last}` : ''}`;
			const list = await this.get<EsploraTx[]>(path, !!last);
			if (!Array.isArray(list) || list.length === 0) return { txs: out, pages: page + 1, more: false };
			for (const t of list) {
				const time = t.status?.block_time ?? 0;
				if (time > toUnix) continue;
				if (time < fromUnix) return { txs: out, pages: page + 1, more: false };
				out.push(t);
			}
			if (list.length < 25) return { txs: out, pages: page + 1, more: false };
			last = list[list.length - 1].txid;
		}
		return { txs: out, pages: maxPages, more: true };
	}
}

/** The ASCII text of a transaction's OP_RETURN output, if any. */
export function opReturnText(tx: EsploraTx): string | undefined {
	for (const o of tx.vout) {
		if (o.scriptpubkey_type !== 'op_return') continue;
		const hex = o.scriptpubkey ?? '';
		// OP_RETURN (6a) + a push opcode; the payload is what follows
		const m = /^6a(?:4c[0-9a-f]{2}|4d[0-9a-f]{4}|[0-9a-f]{2})([0-9a-f]*)$/i.exec(hex);
		if (!m) continue;
		const bytes = Buffer.from(m[1], 'hex');
		return bytes.toString('latin1');
	}
	return undefined;
}

/**
 * A THORChain (or Maya) deposit: the memo grammar is `<action>:<params>`,
 * e.g. `=:ETH.ETH:0x…`, `SWAP:…`, `+:BTC.BTC:thor1…`. Its vault output is
 * THORChain's, never the depositor's next hop.
 */
export const DEPOSIT_MEMO = /^(=|s|swap|\+|a|add|-|wd|withdraw|~|trade[+-]|secure[+-]|loan[+-]|\$[+-]|pool[+-]|noop|bond|unbond|leave|migrate|tcy[+-]?):/i;

export function isDepositMemo(text: string | undefined): boolean {
	return !!text && DEPOSIT_MEMO.test(text.trim());
}

/**
 * CoinJoin-like: many inputs and several equal-value outputs (Wasabi,
 * Whirlpool, JoinMarket). Ownership heuristics do not hold across it.
 */
export function isCoinJoin(tx: EsploraTx): boolean {
	if (tx.vin.length < 5) return false;
	const counts = new Map<number, number>();
	for (const o of tx.vout) if (o.value > 0) counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
	return Math.max(0, ...counts.values()) >= 5;
}
