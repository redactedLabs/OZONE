import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { reports } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fetchMidgardActions, fetchBalances, groupTransactions } from '$lib/server/historyService';

function generateReportId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
	return id;
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

		const groups = groupTransactions(allTxs, address);

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
			txData: JSON.stringify({ transactions: allTxs, balances, groups }),
		});

		return json({
			reportId,
			totalTransactions: allTxs.length,
			transactions: allTxs,
			groups,
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

		const groups = groupTransactions(filtered, report.address);

		await db.update(reports)
			.set({ txCount: filtered.length, txData: JSON.stringify({ transactions: filtered, balances, groups }) })
			.where(eq(reports.reportId, reportId.toUpperCase()));

		return json({
			reportId: report.reportId,
			totalTransactions: filtered.length,
			transactions: filtered,
			groups,
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
	// Backward compat: old reports may not have groups
	const groups = stored.groups || groupTransactions(Array.isArray(transactions) ? transactions : [], report.address);

	return json({
		reportId: report.reportId,
		totalTransactions: report.txCount,
		transactions: Array.isArray(transactions) ? transactions : [],
		groups,
		balances,
		dateFrom: report.dateFrom?.toISOString() || null,
		dateTo: report.dateTo?.toISOString() || null,
		includeNew: false,
		revealWallet: report.revealWallet || false,
		address: report.revealWallet ? report.address : null,
		generated: report.createdAt?.toISOString(),
	});
};
