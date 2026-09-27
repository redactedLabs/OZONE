/**
 * Turns a Midgard action into value flows between addresses.
 *
 * - swap (incl. streaming, L1→L1, L1→RUNE, trade/secured assets): every
 *   inbound sender → every non-affiliate outbound recipient (what the
 *   recipient actually received);
 * - send (native MsgSend): sender → recipient;
 * - withdraw: requester → the member's payout addresses;
 * - addLiquidity: the asset-side and RUNE-side addresses of one deposit own
 *   the position together (`lp_pair` ownership link, both directions);
 * - thorname: owner ↔ registered alias address (`thorname` ownership link);
 * - refunds go back to the sender and produce no flow.
 *
 * Affiliate fee outputs, THORChain module accounts and CosmWasm contracts
 * (32-byte thor addresses) are never flow targets.
 */
import { detectAddress, parseForChain, type ParsedAddress } from '../../../ozone-client/src/index.js';
import type { MidgardAction, MidgardTx } from './midgard.js';
import type { PriceOracle } from './prices.js';

export type Relation = 'value' | 'lp_pair' | 'thorname';

export interface Flow {
	txid: string;
	height: number;
	date: string;
	action: string;
	relation: Relation;
	fromKey: string;
	fromAddress: string;
	fromChain: string;
	toKey: string;
	toAddress: string;
	toChain: string;
	/** e.g. `1.21327264 BTC.BTC` */
	amount?: string;
	usd?: number;
}

/**
 * THORChain module accounts (never flagged: they hold everybody's funds).
 * From THORNode `/thorchain/balance/module/<name>` (3.20.3).
 */
export const THORCHAIN_MODULES = new Set([
	'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0', // asgard
	'thor17gw75axcnr8747pkanye45pnrwk7p9c3cqncsv', // bond
	'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt', // reserve
	'thor1x0kgm82cnj0vtmzdvz4avk3e7sj427t0egk70p', // lending
	'thor1dl7un46w7l7f3ewrnrm6nq58nerjtp0dradjtd', // affiliate_collector
	'thor1v8ppstuf6e3x0r4glqc68d5jqcs2tf38cg2q6y', // thorchain
	'thor1ss8rrf3twa20kf9frdyru05dmu2kg9ll2efcyd', // tcy_claim
	'thor128a8hqnkaxyqv7qwajpggmfyudh64jl3c32vyv', // tcy_stake
	'thor1vmafl8f3s6uuzwnxkqz0eza47v6ecn0t086r2p', // treasury
	'thor1rzqfv62dzu585607s5awqtgnvvwz5rzhdtv772' // rune_pool
]);

const ZERO_TX = /^0+$/;

export function actionDate(a: MidgardAction): string {
	try {
		return new Date(Number(BigInt(a.date) / 1_000_000n)).toISOString();
	} catch {
		return new Date(0).toISOString();
	}
}

export function actionTxid(a: MidgardAction): string {
	for (const t of [...a.in, ...a.out]) if (t.txID && !ZERO_TX.test(t.txID)) return t.txID.toUpperCase();
	return `H${a.height}:${a.type}`;
}

export function chainOfAsset(asset: string): string | undefined {
	const m = /^([A-Z0-9]+)[.~/-]/.exec(asset.toUpperCase());
	return m?.[1];
}

/** Address of a Midgard in/out tx as a parsed address (chain from the asset for EVM). */
export function parseTxAddress(tx: MidgardTx): ParsedAddress | null {
	const addr = (tx.address ?? '').trim();
	if (!addr) return null;
	const assetChain = tx.coins?.[0]?.asset ? chainOfAsset(tx.coins[0].asset) : undefined;
	if (assetChain && assetChain !== 'THOR') {
		const p = parseForChain(addr, assetChain);
		if (p) return p;
	}
	return detectAddress(addr)[0] ?? null;
}

export function isExcludedTarget(p: ParsedAddress): boolean {
	if (p.namespace === 'thor') return p.kind === 'contract32' || THORCHAIN_MODULES.has(p.address);
	return false;
}

function formatAmount(amount: string, asset: string): string {
	const n = Number(amount) / 1e8;
	const s = n >= 1 ? n.toFixed(4) : n.toPrecision(4);
	return `${Number(s)} ${asset}`;
}

export function extractFlows(a: MidgardAction, prices?: PriceOracle): Flow[] {
	if (a.status === 'failed') return [];
	const base = { txid: actionTxid(a), height: Number(a.height), date: actionDate(a), action: a.type };
	const flows: Flow[] = [];
	const meta = a.metadata ?? {};
	const affiliateAddr = String(meta.swap?.affiliateAddress ?? meta.refund?.affiliateAddress ?? '').toLowerCase();
	const priceOf = (asset: string, which: 'in' | 'out'): number | undefined => {
		const swap = meta.swap;
		if (swap) {
			const p = Number(which === 'in' ? swap.inPriceUSD : swap.outPriceUSD);
			if (p > 0) return p;
		}
		return prices?.priceUsd(asset);
	};

	const ins = a.in.map((t) => ({ t, p: parseTxAddress(t) })).filter((x) => x.p) as Array<{ t: MidgardTx; p: ParsedAddress }>;

	if (a.type === 'thorname') {
		const tn = meta.thorname ?? {};
		const owner = String(tn.owner ?? '');
		const alias = String(tn.address ?? '');
		const aliasChain = String(tn.chain ?? '');
		const po = owner ? parseForChain(owner, 'THOR') : null;
		const pa = alias ? (parseForChain(alias, aliasChain) ?? detectAddress(alias)[0] ?? null) : null;
		// THORNode lets a registrant set `owner` to any thor address, so an
		// owner that did not sign this action is an unverified assertion about
		// a third party, not proof of common ownership.
		const ownerSigned = po ? ins.some((x) => x.p.key === po.key) : false;
		if (po && pa && po.key !== pa.key && ownerSigned) {
			const name = String(tn.thorname ?? '');
			for (const [f, t] of [
				[po, pa],
				[pa, po]
			] as const) {
				flows.push({
					...base,
					relation: 'thorname',
					fromKey: f.key,
					fromAddress: f.address,
					fromChain: f.chain,
					toKey: t.key,
					toAddress: t.address,
					toChain: t.chain,
					amount: name ? `THORName ${name}` : undefined
				});
			}
		}
		return flows;
	}

	if (a.type === 'addLiquidity') {
		for (const x of ins) {
			for (const y of ins) {
				if (x.p.key === y.p.key || isExcludedTarget(y.p)) continue;
				const coin = x.t.coins?.[0];
				const price = coin ? priceOf(coin.asset, 'in') : undefined;
				flows.push({
					...base,
					relation: 'lp_pair',
					fromKey: x.p.key,
					fromAddress: x.p.address,
					fromChain: x.p.chain,
					toKey: y.p.key,
					toAddress: y.p.address,
					toChain: y.p.chain,
					amount: coin ? formatAmount(coin.amount, coin.asset) : undefined,
					usd: coin && price ? (Number(coin.amount) / 1e8) * price : undefined
				});
			}
		}
		return flows;
	}

	for (const o of a.out) {
		if (o.affiliate) continue;
		const po = parseTxAddress(o);
		if (!po || isExcludedTarget(po)) continue;
		if (affiliateAddr && po.address.toLowerCase() === affiliateAddr) continue;
		const coin = o.coins?.[0];
		const price = coin ? priceOf(coin.asset, 'out') : undefined;
		const usd = coin && price ? (Number(coin.amount) / 1e8) * price : undefined;
		for (const x of ins) {
			if (x.p.key === po.key) continue; // refunds, self-swaps
			flows.push({
				...base,
				relation: 'value',
				fromKey: x.p.key,
				fromAddress: x.p.address,
				fromChain: x.p.chain,
				toKey: po.key,
				toAddress: po.address,
				toChain: po.chain,
				amount: coin ? formatAmount(coin.amount, coin.asset) : undefined,
				usd
			});
		}
	}
	return flows;
}
