import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { reports } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const MIDGARD_URL = 'https://gateway.liquify.com/chain/thorchain_midgard';
const THORNODE_URL = 'https://thornode.ninerealms.com';

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
	if (n > 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n > 1) return n.toFixed(2);
	if (n > 0.001) return n.toFixed(4);
	return n.toString();
}

function rawAmount(raw: string): string {
	if (!raw) return '0';
	return (parseInt(raw) / 1e8).toString();
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
	return all;
}

async function fetchBalances(address: string): Promise<Array<{ asset: string; amount: string }>> {
	try {
		const res = await fetch(`${THORNODE_URL}/cosmos/bank/v1beta1/balances/${address}`);
		if (!res.ok) return [];
		const data = await res.json();
		const balances = data?.balances || [];
		return balances
			.map((b: any) => ({
				asset: b.denom === 'rune' ? 'RUNE' : cleanAsset(b.denom || ''),
				amount: formatAmount(b.amount || '0'),
			}))
			.filter((b: any) => b.amount !== '0');
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
