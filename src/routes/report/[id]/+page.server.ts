import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { reports } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

const MIDGARD_URL = 'https://gateway.liquify.com/chain/thorchain_midgard';
const THORNODE_URL = 'https://gateway.liquify.com/chain/thorchain_api';

function cleanAsset(asset: string): string {
	if (!asset) return '';
	let name = asset;
	if (name.includes('~')) name = name.split('~')[1];
	else if (name.includes('/')) name = name.split('/')[1];
	else if (name.includes('.')) name = name.split('.')[1];
	const dashParts = name.split('-');
	if (dashParts.length >= 3) return dashParts[1];
	if (dashParts.length === 2) {
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

function parseAction(a: any) {
	const ins = a.in || [];
	const outs = a.out || [];
	const coinsIn = ins[0]?.coins?.[0] || {};
	const coinsOut = outs[0]?.coins?.[0] || {};

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
	};
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

export const load: PageServerLoad = async ({ params }) => {
	const reportId = params.id.toUpperCase();

	const [report] = await db.select().from(reports)
		.where(eq(reports.reportId, reportId))
		.limit(1);

	if (!report) {
		throw error(404, 'Report not found');
	}

	let transactions: any[];
	let balances: Array<{ asset: string; amount: string }> = [];

	if (report.includeNew) {
		// Live report — re-fetch latest transactions and balances
		[transactions, balances] = await Promise.all([
			fetchMidgardActions(report.address),
			fetchBalances(report.address),
		]);

		if (report.dateFrom) {
			const from = new Date(report.dateFrom).getTime();
			transactions = transactions.filter(tx => tx.date && new Date(tx.date).getTime() >= from);
		}

		await db.update(reports)
			.set({ txCount: transactions.length, txData: JSON.stringify({ transactions, balances }) })
			.where(eq(reports.reportId, reportId));
	} else {
		const stored = JSON.parse(report.txData || '{}');
		// Backward compatible: old format was just an array, new format is { transactions, balances }
		if (Array.isArray(stored)) {
			transactions = stored;
			balances = [];
		} else {
			transactions = stored.transactions || [];
			balances = stored.balances || [];
		}
	}

	return {
		reportId: report.reportId,
		totalTransactions: transactions.length,
		transactions,
		balances,
		dateFrom: report.dateFrom?.toISOString() || null,
		dateTo: report.dateTo?.toISOString() || null,
		includeNew: report.includeNew || false,
		revealWallet: report.revealWallet || false,
		address: report.revealWallet ? report.address : null,
		generated: report.createdAt?.toISOString() || null,
	};
};
