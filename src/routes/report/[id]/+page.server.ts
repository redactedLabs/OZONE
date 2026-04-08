import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { reports } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { fetchMidgardActions, fetchBalances, groupTransactions } from '$lib/server/historyService';

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
	let groups: any[];

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

		groups = groupTransactions(transactions, report.address);

		await db.update(reports)
			.set({ txCount: transactions.length, txData: JSON.stringify({ transactions, balances, groups }) })
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
		// Backward compat: old reports may not have groups
		groups = stored.groups || groupTransactions(transactions, report.address);
	}

	return {
		reportId: report.reportId,
		totalTransactions: transactions.length,
		transactions,
		groups,
		balances,
		dateFrom: report.dateFrom?.toISOString() || null,
		dateTo: report.dateTo?.toISOString() || null,
		includeNew: report.includeNew || false,
		revealWallet: report.revealWallet || false,
		address: report.revealWallet ? report.address : null,
		generated: report.createdAt?.toISOString() || null,
	};
};
