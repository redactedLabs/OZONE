import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { reports } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const MIDGARD_URL = 'https://gateway.liquify.com/chain/thorchain_midgard';
const THORNODE_URL = 'https://gateway.liquify.com/chain/thorchain_api';

function cleanAsset(asset: string): string {
	if (!asset) return '';
	let name = asset;
	// Handle synths (tilde): ETH~USDC-0x... → USDC-0x...
	if (name.includes('~')) name = name.split('~')[1];
	// Handle slash: X/RUJI → RUJI
	else if (name.includes('/')) name = name.split('/')[1];
	// Handle dot: THOR.RUNE → RUNE, ETH.USDC-0x → USDC-0x
	else if (name.includes('.')) name = name.split('.')[1];
	// Strip contract address (0x...) if present
	const dashParts = name.split('-');
	if (dashParts.length >= 3) return dashParts[1]; // ETH-USDC-0xCONTRACT → USDC
	if (dashParts.length === 2) {
		// Contract address → return token name (first part)
		// Covers EVM 0x..., TRON T..., and any long address suffix
		if (dashParts[1].length > 6) return dashParts[0];
		if (dashParts[0] === dashParts[1]) return dashParts[0];
		return dashParts[1];
	}
	return dashParts[0];
}

function formatAmount(raw: string): string {
	if (!raw) return '0';
	const n = parseInt(raw) / 1e8;
	if (n === 0) return '0';
	if (n > 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n > 1) return n.toFixed(2);
	if (n > 0.001) return n.toFixed(4);
	if (n > 0.000001) return n.toFixed(6);
	return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function rawAmount(raw: string): string {
	if (!raw) return '0';
	const n = parseInt(raw) / 1e8;
	if (n === 0) return '0';
	return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Rujira contract type mapping ──
const RUJIRA_TYPE_MAP: Record<string, { type: string; label: string }> = {
	// FIN — Orderbook DEX
	'wasm-rujira-fin/trade':              { type: 'fin-trade',       label: 'Trade (Orderbook)' },
	'wasm-rujira-fin/arb':                { type: 'fin-arb',         label: 'Arb' },
	'wasm-rujira-fin/order.create':       { type: 'fin-order',       label: 'Limit Order' },
	'wasm-rujira-fin/order.withdraw':     { type: 'fin-order-wd',    label: 'Cancel Order' },
	'wasm-rujira-fin/order.increase':     { type: 'fin-order-inc',   label: 'Increase Order' },
	'wasm-rujira-fin/order.retract':      { type: 'fin-order-dec',   label: 'Retract Order' },
	'wasm-rujira-fin/market-maker.fee':   { type: 'fin-mm-fee',      label: 'MM Fee' },
	// FIN Range — Concentrated Liquidity
	'wasm-rujira-fin/range.create':       { type: 'fin-range',       label: 'Range Create' },
	'wasm-rujira-fin/range.deposit':      { type: 'fin-range-dep',   label: 'Range Deposit' },
	'wasm-rujira-fin/range.withdraw':     { type: 'fin-range-wd',    label: 'Range Withdraw' },
	'wasm-rujira-fin/range.claim':        { type: 'fin-range-claim', label: 'Range Claim' },
	'wasm-rujira-fin/range.close':        { type: 'fin-range-close', label: 'Range Close' },
	'wasm-rujira-fin/range.transfer':     { type: 'fin-range-xfer',  label: 'Range Transfer' },
	'wasm-rujira-fin/range.fee':          { type: 'fin-range-fee',   label: 'Range Fee' },
	// BOW — AMM Pools
	'wasm-rujira-bow/swap':               { type: 'bow-swap',        label: 'AMM Swap' },
	'wasm-rujira-bow/deposit':            { type: 'bow-deposit',     label: 'AMM Deposit' },
	'wasm-rujira-bow/withdraw':           { type: 'bow-withdraw',    label: 'AMM Withdraw' },
	// TC Swap — THORChain Base Layer
	'wasm-rujira-thorchain-swap/swap':    { type: 'tc-swap',         label: 'Swap (TC)' },
	// GHOST Vault — Lending
	'wasm-rujira-ghost-vault/borrow':     { type: 'ghost-borrow',    label: 'Borrow' },
	'wasm-rujira-ghost-vault/repay':      { type: 'ghost-repay',     label: 'Repay' },
	'wasm-rujira-ghost-vault/deposit':    { type: 'ghost-lend',      label: 'Lend' },
	'wasm-rujira-ghost-vault/withdraw':   { type: 'ghost-withdraw',  label: 'Withdraw Lend' },
	// GHOST Credit — Credit Accounts
	'wasm-rujira-ghost-credit/account.create':       { type: 'ghost-credit-create', label: 'Credit Account' },
	'wasm-rujira-ghost-credit/account.msg':          { type: 'ghost-credit-action', label: 'Credit Action' },
	'wasm-rujira-ghost-credit/account.msg/borrow':   { type: 'ghost-credit-borrow', label: 'Credit Borrow' },
	'wasm-rujira-ghost-credit/account.msg/repay':    { type: 'ghost-credit-repay',  label: 'Credit Repay' },
	'wasm-rujira-ghost-credit/account.msg/send':     { type: 'ghost-credit-send',   label: 'Credit Send' },
	'wasm-rujira-ghost-credit/account.msg/execute':  { type: 'ghost-credit-exec',   label: 'Credit Execute' },
	'wasm-rujira-ghost-credit/account.liquidate':    { type: 'ghost-liquidation',   label: 'Liquidation' },
	// CALC — DCA (Calculated Finance)
	'wasm-calc-strategy/init':            { type: 'calc-init',       label: 'DCA Create' },
	'wasm-calc-strategy/process':         { type: 'calc-process',    label: 'DCA Execute' },
	'wasm-calc-strategy/withdraw':        { type: 'calc-withdraw',   label: 'DCA Withdraw' },
	'wasm-calc-manager/strategy.create':  { type: 'calc-create',     label: 'DCA Strategy' },
	'wasm-calc-strategy/process-node.result':   { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/process-node.messages': { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/update':                { type: 'calc-update',   label: 'DCA Update' },
	'wasm-calc-manager/strategy.update':        { type: 'calc-update',   label: 'DCA Update' },
	// Auto Workflow (AutoRujira)
	'wasm-autorujira-workflow-manager/execute_instance': { type: 'auto-workflow',    label: 'Auto Workflow' },
	'wasm-autorujira-workflow-manager/cancel_instance':  { type: 'auto-cancel',      label: 'Cancel Workflow' },
	// Staking (RUJI/sTCY)
	'wasm-rujira-staking/liquid.bond':    { type: 'ruji-stake',      label: 'RUJI Stake' },
	'wasm-rujira-staking/liquid.unbond':  { type: 'ruji-unstake',    label: 'RUJI Unstake' },
	'wasm-rujira-staking/account.bond':   { type: 'ruji-stake',      label: 'RUJI Stake' },
	'wasm-rujira-staking/account.claim':  { type: 'ruji-claim',      label: 'RUJI Claim' },
	'wasm-rujira-staking/account.withdraw': { type: 'ruji-unstake',  label: 'RUJI Unstake' },
	// Pilot — Liquidation marketplace
	'wasm-rujira-pilot/swap':             { type: 'pilot-swap',      label: 'Liquidation Swap' },
	'wasm-rujira-pilot/order':            { type: 'pilot-order',     label: 'Liquidation Bid' },
	// Liquidy Swap (cross-chain router)
	'wasm-liquidy-swap/swap':             { type: 'liquidy-swap',    label: 'Liquidy Swap' },
	'wasm-liquidy-swap/execute':          { type: 'liquidy-exec',    label: 'Liquidy Execute' },
	'wasm-liquidy-swap-execute':          { type: 'liquidy-exec',    label: 'Liquidy Execute' },
	// BRUNE — BTC stablecoin
	'wasm-rujira-brune/swap':             { type: 'brune-swap',      label: 'BRUNE Swap' },
	// Nami Index
	'wasm-nami-index-fixed/deposit':      { type: 'nami-deposit',    label: 'Index Deposit' },
	'wasm-nami-index-fixed/withdraw':     { type: 'nami-withdraw',   label: 'Index Withdraw' },
	'wasm-nami-index-nav/deposit':        { type: 'nami-deposit',    label: 'Index Deposit' },
	'wasm-nami-index-nav/withdraw':       { type: 'nami-withdraw',   label: 'Index Withdraw' },
	// Revenue
	'wasm-rujira-revenue/run':            { type: 'revenue-run',     label: 'Revenue Dist' },
	// Merge
	'wasm-rujira-merge/deposit':          { type: 'merge-deposit',   label: 'Merge Deposit' },
	'wasm-rujira-merge/withdraw':         { type: 'merge-withdraw',  label: 'Merge Withdraw' },
};

// Dedup priority — lower = keep as primary; higher = show as sibling
const DEDUP_PRIORITY: Record<string, number> = {
	'swap': 1, 'addLiquidity': 2, 'withdraw': 3, 'send': 4, 'refund': 5,
	'switch': 6, 'secure': 7, 'tcy_stake': 8, 'tcy_unstake': 9, 'donate': 10,
	'calc-create': 20, 'calc-update': 21, 'calc-withdraw': 22,
	'fin-order': 23, 'fin-order-wd': 24, 'fin-order-inc': 23, 'fin-order-dec': 24,
	'fin-range': 25, 'fin-range-dep': 25, 'fin-range-wd': 25,
	'fin-range-claim': 25, 'fin-range-close': 25, 'fin-range-xfer': 25,
	'ghost-lend': 26, 'ghost-withdraw': 27,
	'ghost-credit-create': 28, 'ghost-credit-action': 29,
	'ghost-credit-borrow': 28, 'ghost-credit-repay': 28,
	'ghost-credit-send': 29, 'ghost-credit-exec': 29,
	'ghost-liquidation': 28,
	'tc-swap': 30, 'bow-swap': 31, 'bow-deposit': 31, 'bow-withdraw': 31, 'fin-trade': 32,
	'auto-workflow': 40, 'auto-cancel': 40,
	'ruji-stake': 41, 'ruji-unstake': 41, 'ruji-claim': 41,
	'pilot-swap': 42, 'pilot-order': 42,
	'liquidy-swap': 43, 'liquidy-exec': 44,
	'brune-swap': 45,
	'nami-deposit': 46, 'nami-withdraw': 46,
	'calc-process': 50, 'calc-init': 51, 'calc-internal': 52,
	'ghost-borrow': 60, 'ghost-repay': 61,
	'fin-arb': 70, 'fin-range-fee': 71, 'fin-mm-fee': 72,
	'revenue-run': 80, 'merge-deposit': 81, 'merge-withdraw': 81,
	'contract': 100, 'unknown': 999,
};

function parseFunds(fundsStr: string): Array<{ amount: string; asset: string }> {
	if (!fundsStr) return [];
	return fundsStr.split(',').map(part => {
		const match = part.trim().match(/^(\d+)(.+)$/);
		if (!match) return null;
		return { amount: match[1], asset: cleanAsset(match[2]) };
	}).filter(Boolean) as Array<{ amount: string; asset: string }>;
}

function parseContractAction(a: any): { type: string; assetIn: string; assetOut: string; amountIn: string; amountOut: string; rawAmountIn: string; rawAmountOut: string } | null {
	const contract = a.metadata?.contract;
	if (!contract?.contractType) return null;

	const mapped = RUJIRA_TYPE_MAP[contract.contractType];
	if (!mapped) return null;

	const attrs = contract.attributes || {};
	const funds = parseFunds(contract.funds || '');
	const fundAsset = funds[0]?.asset || '';
	const fundAmount = funds[0]?.amount || '0';

	let assetIn = '', assetOut = '', rawIn = '0', rawOut = '0';

	switch (mapped.type) {
		case 'fin-trade': {
			// Orderbook trade: bid attribute is a bare number (no denom)
			// assetOut left empty — resolved in 2-pass by txID grouping
			assetIn = fundAsset;
			rawIn = fundAmount;
			rawOut = attrs.bid || attrs.offer || '0';
			break;
		}
		case 'bow-swap':
		case 'tc-swap': {
			// AMM/TC swap: offer → ask
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.ask) {
				const askParts = attrs.ask.match(/^(\d+)(.+)$/);
				if (askParts) { rawOut = askParts[1]; assetOut = cleanAsset(askParts[2]); }
			}
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'ghost-borrow': {
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-repay': {
			assetIn = fundAsset;
			rawIn = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-lend': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'ghost-withdraw': {
			assetOut = fundAsset;
			rawOut = fundAmount;
			break;
		}
		case 'fin-range': {
			// Range LP: deposited base + quote
			if (funds.length >= 2) {
				assetIn = funds[0].asset;
				rawIn = funds[0].amount;
				assetOut = funds[1].asset;
				rawOut = funds[1].amount;
			} else if (funds.length === 1) {
				assetIn = fundAsset;
				rawIn = fundAmount;
			}
			break;
		}
		case 'fin-range-fee': {
			// Fee collection
			if (attrs.base && attrs.base !== '0') { rawOut = attrs.base; }
			if (attrs.quote && attrs.quote !== '0') { rawOut = attrs.quote; }
			break;
		}
		case 'fin-order': {
			// Limit order placement — funds are the offer
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'fin-order-wd': {
			// Limit order withdrawal — amount returned
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'fin-order-inc':
		case 'fin-order-dec': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'fin-range-dep': {
			// Add liquidity to existing range
			if (funds.length >= 2) {
				assetIn = funds[0].asset; rawIn = funds[0].amount;
				assetOut = funds[1].asset; rawOut = funds[1].amount;
			} else if (funds.length === 1) {
				assetIn = fundAsset; rawIn = fundAmount;
			}
			break;
		}
		case 'fin-range-wd':
		case 'fin-range-close': {
			// Withdraw/close range position
			assetOut = fundAsset;
			rawOut = fundAmount;
			if (attrs.amount) rawOut = attrs.amount;
			break;
		}
		case 'fin-range-claim': {
			// Claim accumulated fees
			if (attrs.base && attrs.base !== '0') { rawOut = attrs.base; }
			if (attrs.quote && attrs.quote !== '0') { rawOut = attrs.quote; }
			break;
		}
		case 'fin-range-xfer': {
			// Transfer range ownership — no funds
			break;
		}
		case 'fin-mm-fee': {
			// Market maker fee collection
			if (attrs.base && attrs.base !== '0') { rawOut = attrs.base; }
			if (attrs.quote && attrs.quote !== '0') { rawOut = attrs.quote; }
			break;
		}
		case 'ghost-credit-create': {
			// Create credit account — no funds
			break;
		}
		case 'ghost-credit-borrow': {
			assetOut = fundAsset;
			rawOut = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-credit-repay': {
			assetIn = fundAsset;
			rawIn = attrs.amount || fundAmount;
			break;
		}
		case 'ghost-credit-send':
		case 'ghost-credit-exec':
		case 'ghost-credit-action': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		case 'ghost-liquidation': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		case 'bow-deposit': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'bow-withdraw': {
			assetOut = fundAsset;
			rawOut = fundAmount;
			break;
		}
		case 'ruji-stake': {
			assetIn = fundAsset || 'RUJI';
			rawIn = fundAmount;
			break;
		}
		case 'ruji-unstake':
		case 'ruji-claim': {
			assetOut = fundAsset || 'RUJI';
			rawOut = fundAmount;
			break;
		}
		case 'pilot-swap': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'pilot-order': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'liquidy-swap':
		case 'liquidy-exec': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'brune-swap': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			if (attrs.returned) {
				const retParts = attrs.returned.match(/^(\d+)(.+)$/);
				if (retParts) { rawOut = retParts[1]; assetOut = cleanAsset(retParts[2]); }
			}
			break;
		}
		case 'nami-deposit': {
			assetIn = fundAsset;
			rawIn = fundAmount;
			break;
		}
		case 'nami-withdraw': {
			assetOut = fundAsset;
			rawOut = fundAmount;
			break;
		}
		case 'auto-workflow':
		case 'auto-cancel':
		case 'revenue-run':
		case 'merge-deposit':
		case 'merge-withdraw': {
			if (fundAmount !== '0') { assetIn = fundAsset; rawIn = fundAmount; }
			break;
		}
		default: {
			// For DCA and others, use funds if available
			if (fundAmount !== '0') {
				assetIn = fundAsset;
				rawIn = fundAmount;
			}
			break;
		}
	}

	return {
		type: mapped.type,
		assetIn,
		assetOut,
		amountIn: formatAmount(rawIn),
		amountOut: formatAmount(rawOut),
		rawAmountIn: rawAmount(rawIn),
		rawAmountOut: rawAmount(rawOut),
	};
}

function extractFees(a: any): { feeAmount: string; feeCurrency: string } {
	const meta = a.metadata || {};

	// Try networkFees first (present on swaps, withdrawals, etc.)
	const swapMeta = meta.swap || meta.addLiquidity || meta.withdraw || {};
	const networkFees = swapMeta.networkFees || a.metadata?.withdraw?.networkFees || [];
	if (networkFees.length > 0) {
		const fee = networkFees[0];
		return {
			feeAmount: rawAmount(fee.amount || '0'),
			feeCurrency: cleanAsset(fee.asset || ''),
		};
	}

	// Fall back to liquidityFee (swap-specific, denominated in RUNE)
	if (swapMeta.liquidityFee && swapMeta.liquidityFee !== '0') {
		return {
			feeAmount: rawAmount(swapMeta.liquidityFee),
			feeCurrency: 'RUNE',
		};
	}

	return { feeAmount: '', feeCurrency: '' };
}

function parseAction(a: any) {
	const ins = a.in || [];
	const outs = a.out || [];
	const coinsIn = ins[0]?.coins?.[0] || {};
	const coinsOut = outs[0]?.coins?.[0] || {};
	const fees = extractFees(a);

	// Try to decode Rujira contract interactions
	if (a.type === 'contract') {
		const decoded = parseContractAction(a);
		if (decoded) {
			return {
				type: decoded.type,
				date: a.date ? new Date(parseInt(a.date) / 1e6).toISOString() : '',
				assetIn: decoded.assetIn,
				assetOut: decoded.assetOut,
				amountIn: decoded.amountIn,
				amountOut: decoded.amountOut,
				rawAmountIn: decoded.rawAmountIn,
				rawAmountOut: decoded.rawAmountOut,
				from: ins[0]?.address || '',
				to: outs[0]?.address || '',
				txID: ins[0]?.txID || '',
				status: a.status || 'unknown',
				feeAmount: fees.feeAmount,
				feeCurrency: fees.feeCurrency,
			};
		}
	}

	return {
		type: a.type || 'unknown',
		date: a.date ? new Date(parseInt(a.date) / 1e6).toISOString() : '',
		assetIn: cleanAsset(coinsIn.asset || ''),
		assetOut: cleanAsset(coinsOut.asset || ''),
		amountIn: formatAmount(coinsIn.amount || '0'),
		amountOut: formatAmount(coinsOut.amount || '0'),
		rawAmountIn: rawAmount(coinsIn.amount || '0'),
		rawAmountOut: rawAmount(coinsOut.amount || '0'),
		from: ins[0]?.address || '',
		to: outs[0]?.address || '',
		txID: ins[0]?.txID || '',
		status: a.status || 'unknown',
		feeAmount: fees.feeAmount,
		feeCurrency: fees.feeCurrency,
	};
}

function generateReportId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
	return id;
}

async function fetchMidgardActions(address: string): Promise<any[]> {
	let all: any[] = [];
	const pageSize = 50;
	const maxPages = 100;
	let nextPageToken: string | null = null;

	for (let page = 0; page < maxPages; page++) {
		try {
			let url = `${MIDGARD_URL}/v2/actions?address=${address}&limit=${pageSize}`;
			if (nextPageToken) {
				url += `&nextPageToken=${nextPageToken}`;
			} else if (page > 0) {
				break;
			}

			const res = await fetch(url);
			if (!res.ok) break;
			const data: any = await res.json();
			const actions = data?.actions || [];
			if (actions.length === 0) break;

			all.push(...actions.map(parseAction).filter(Boolean));

			nextPageToken = data?.meta?.nextPageToken || null;
			if (!nextPageToken || actions.length < pageSize) break;

			await new Promise(r => setTimeout(r, 150));
		} catch { break; }
	}

	// 2-pass: resolve fin-trade output assets from sibling tc-swap/bow-swap
	const byTxID = new Map<string, any[]>();
	for (const tx of all) {
		if (tx.txID) {
			if (!byTxID.has(tx.txID)) byTxID.set(tx.txID, []);
			byTxID.get(tx.txID)!.push(tx);
		}
	}
	for (const [, group] of byTxID) {
		let resolvedOutAsset = '';
		for (const tx of group) {
			if ((tx.type === 'tc-swap' || tx.type === 'bow-swap') && tx.assetOut) {
				resolvedOutAsset = tx.assetOut;
				break;
			}
		}
		if (resolvedOutAsset) {
			for (const tx of group) {
				if (tx.type === 'fin-trade' && !tx.assetOut) {
					tx.assetOut = resolvedOutAsset;
				}
			}
		}
	}

	return all;
}

async function fetchBalances(address: string): Promise<Array<{ asset: string; amount: string }>> {
	try {
		const res = await fetch(`${THORNODE_URL}/cosmos/bank/v1beta1/balances/${address}`);
		if (!res.ok) return [];
		const data = await res.json();
		const balances = data?.balances || [];

		// Merge duplicates (same cleaned name from different denoms/synths/chains)
		const merged = new Map<string, number>();
		for (const b of balances) {
			const asset = b.denom === 'rune' ? 'RUNE' : cleanAsset(b.denom || '');
			const raw = parseInt(b.amount || '0');
			if (raw === 0) continue;
			merged.set(asset, (merged.get(asset) || 0) + raw);
		}

		return [...merged.entries()]
			.sort(([, a], [, b]) => b - a)
			.map(([asset, total]) => ({
				asset,
				amount: formatAmount(String(total)),
			}))
			.filter(b => b.amount !== '0');
	} catch {
		return [];
	}
}

// POST — fetch history + create shareable report
export const POST: RequestHandler = async ({ request }) => {
	const { address, dateFrom, dateTo, includeNew, revealWallet } = await request.json();

	if (!address || !address.startsWith('thor')) {
		return json({ error: 'Valid thor address required' }, { status: 400 });
	}

	try {
		const [allTxsRaw, balances] = await Promise.all([
			fetchMidgardActions(address),
			fetchBalances(address),
		]);

		let allTxs = allTxsRaw;

		// Apply date filter
		if (dateFrom) {
			const from = new Date(dateFrom).getTime();
			allTxs = allTxs.filter(tx => tx.date && new Date(tx.date).getTime() >= from);
		}
		if (dateTo && !includeNew) {
			const to = new Date(dateTo).getTime();
			allTxs = allTxs.filter(tx => tx.date && new Date(tx.date).getTime() <= to);
		}

		// Generate and store report
		const reportId = generateReportId();

		await db.insert(reports).values({
			reportId,
			address,
			dateFrom: dateFrom ? new Date(dateFrom) : null,
			dateTo: dateTo ? new Date(dateTo) : null,
			includeNew: includeNew || false,
			revealWallet: revealWallet || false,
			txCount: allTxs.length,
			txData: JSON.stringify({ transactions: allTxs, balances }),
		});

		return json({
			reportId,
			totalTransactions: allTxs.length,
			transactions: allTxs,
			balances,
			dateFrom: dateFrom || null,
			dateTo: dateTo || null,
			includeNew: includeNew || false,
			revealWallet: revealWallet || false,
			address: revealWallet ? address : null,
			generated: new Date().toISOString(),
			shareUrl: `/report/${reportId}`,
		});
	} catch (err: any) {
		return json({ error: `Failed: ${err.message}` }, { status: 500 });
	}
};

// GET — refresh a live report (includeNew=true)
export const GET: RequestHandler = async ({ url }) => {
	const reportId = url.searchParams.get('id');
	if (!reportId) return json({ error: 'Missing id' }, { status: 400 });

	const [report] = await db.select().from(reports)
		.where(eq(reports.reportId, reportId.toUpperCase()))
		.limit(1);

	if (!report) return json({ error: 'Report not found' }, { status: 404 });

	// If includeNew, re-fetch and update
	if (report.includeNew) {
		const [allTxs, balances] = await Promise.all([
			fetchMidgardActions(report.address),
			fetchBalances(report.address),
		]);

		let filtered = allTxs;
		if (report.dateFrom) {
			const from = new Date(report.dateFrom).getTime();
			filtered = filtered.filter(tx => tx.date && new Date(tx.date).getTime() >= from);
		}

		await db.update(reports)
			.set({ txCount: filtered.length, txData: JSON.stringify({ transactions: filtered, balances }) })
			.where(eq(reports.reportId, reportId.toUpperCase()));

		return json({
			reportId: report.reportId,
			totalTransactions: filtered.length,
			transactions: filtered,
			balances,
			dateFrom: report.dateFrom?.toISOString() || null,
			dateTo: report.dateTo?.toISOString() || null,
			includeNew: true,
			revealWallet: report.revealWallet || false,
			address: report.revealWallet ? report.address : null,
			generated: report.createdAt?.toISOString(),
		});
	}

	// Static report — return stored data
	const stored = JSON.parse(report.txData || '{}');
	const transactions = stored.transactions || stored;
	const balances = stored.balances || [];

	return json({
		reportId: report.reportId,
		totalTransactions: report.txCount,
		transactions: Array.isArray(transactions) ? transactions : [],
		balances,
		dateFrom: report.dateFrom?.toISOString() || null,
		dateTo: report.dateTo?.toISOString() || null,
		includeNew: false,
		revealWallet: report.revealWallet || false,
		address: report.revealWallet ? report.address : null,
		generated: report.createdAt?.toISOString(),
	});
};
