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
	'wasm-rujira-fin/trade':              { type: 'fin-trade',       label: 'Trade (Orderbook)' },
	'wasm-rujira-fin/arb':                { type: 'fin-arb',         label: 'Arb' },
	'wasm-rujira-fin/range.create':       { type: 'fin-range',       label: 'Range LP' },
	'wasm-rujira-fin/range.fee':          { type: 'fin-range-fee',   label: 'Range Fee' },
	'wasm-rujira-ghost-vault/borrow':     { type: 'ghost-borrow',    label: 'Borrow' },
	'wasm-rujira-ghost-vault/repay':      { type: 'ghost-repay',     label: 'Repay' },
	'wasm-rujira-ghost-vault/deposit':    { type: 'ghost-lend',      label: 'Lend' },
	'wasm-rujira-ghost-vault/withdraw':   { type: 'ghost-withdraw',  label: 'Withdraw Lend' },
	'wasm-rujira-bow/swap':               { type: 'bow-swap',        label: 'AMM Swap' },
	'wasm-rujira-thorchain-swap/swap':    { type: 'tc-swap',         label: 'Swap (TC)' },
	'wasm-calc-strategy/init':            { type: 'calc-init',       label: 'DCA Create' },
	'wasm-calc-strategy/process':         { type: 'calc-process',    label: 'DCA Execute' },
	'wasm-calc-strategy/withdraw':        { type: 'calc-withdraw',   label: 'DCA Withdraw' },
	'wasm-calc-manager/strategy.create':  { type: 'calc-create',     label: 'DCA Strategy' },
	'wasm-calc-strategy/process-node.result':   { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/process-node.messages': { type: 'calc-internal', label: 'DCA (step)' },
	'wasm-calc-strategy/update':                { type: 'calc-update',   label: 'DCA Update' },
	'wasm-calc-manager/strategy.update':        { type: 'calc-update',   label: 'DCA Update' },
	'wasm-rujira-fin/order.create':             { type: 'fin-order',     label: 'Limit Order' },
	'wasm-rujira-fin/order.withdraw':           { type: 'fin-order-wd',  label: 'Cancel Order' },
	'wasm-autorujira-workflow-manager/execute_instance': { type: 'auto-workflow', label: 'Auto Workflow' },
};

// Dedup priority — lower = keep; higher = drop when sibling exists
const DEDUP_PRIORITY: Record<string, number> = {
	'swap': 1, 'addLiquidity': 2, 'withdraw': 3, 'send': 4, 'refund': 5,
	'switch': 6, 'secure': 7, 'tcy_stake': 8, 'tcy_unstake': 9, 'donate': 10,
	'calc-create': 20, 'calc-update': 21, 'calc-withdraw': 22,
	'fin-order': 23, 'fin-order-wd': 24, 'fin-range': 25,
	'ghost-lend': 26, 'ghost-withdraw': 27,
	'tc-swap': 30, 'bow-swap': 31, 'fin-trade': 32,
	'auto-workflow': 40,
	'calc-process': 50, 'calc-init': 51, 'calc-internal': 52,
	'ghost-borrow': 60, 'ghost-repay': 61,
	'fin-arb': 70, 'fin-range-fee': 71,
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
		case 'auto-workflow': {
			// Workflow orchestrator — no funds, just metadata
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
