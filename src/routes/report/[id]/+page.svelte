<script lang="ts">
	import type { PageData } from './$types';
	import { fetchPoolAssets, getTokenLogoSync } from '$lib/utils/tokenLogos';

	let { data }: { data: PageData } = $props();

	let poolAssets = $state<string[]>([]);
	fetchPoolAssets().then((assets) => { poolAssets = assets; });

	function logo(symbol: string): string | undefined {
		return getTokenLogoSync(symbol, poolAssets);
	}

	const typeLabels: Record<string, string> = {
		swap: 'Swap', addLiquidity: 'Add LP', withdraw: 'Withdraw', send: 'Send', refund: 'Refund',
		switch: 'Switch', contract: 'Contract', donate: 'Donate',
	};
	const typeColors: Record<string, string> = {
		swap: 'var(--app-accent)', addLiquidity: '#10b981', withdraw: '#f59e0b', send: '#22d3ee', refund: '#ef4444',
		switch: '#a78bfa', contract: '#64748b', donate: '#f472b6',
	};

	const txSwaps = $derived(data.transactions?.filter((t: any) => t.type === 'swap').length || 0);
	const txAdds = $derived(data.transactions?.filter((t: any) => t.type === 'addLiquidity').length || 0);
	const txWithdraws = $derived(data.transactions?.filter((t: any) => t.type === 'withdraw').length || 0);
	const txSends = $derived(data.transactions?.filter((t: any) => t.type === 'send').length || 0);

	function exportCSV() {
		if (!data.transactions) return;
		const headers = ['Date', 'Type', 'Asset In', 'Amount In', 'Asset Out', 'Amount Out', 'Fee Amount', 'Fee Currency', 'From', 'To', 'TxID', 'Status'];
		const rows = data.transactions.map((tx: any) => [
			tx.date, tx.type, tx.assetIn, tx.rawAmountIn || tx.amountIn, tx.assetOut, tx.rawAmountOut || tx.amountOut, tx.feeAmount || '', tx.feeCurrency || '', tx.from, tx.to, tx.txID, tx.status
		]);
		const csv = [headers, ...rows].map((r: string[]) =>
			r.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(',')
		).join('\n');

		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `ozone-history-${data.reportId}-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportKoinlyCSV() {
		if (!data.transactions) return;
		const headers = ['Date', 'Sent Amount', 'Sent Currency', 'Received Amount', 'Received Currency', 'Fee Amount', 'Fee Currency', 'Net Worth Amount', 'Net Worth Currency', 'Label', 'Description', 'TxHash'];
		const rows = data.transactions.map((tx: any) => {
			const sentAmount = tx.rawAmountIn || tx.amountIn;
			const sentCurrency = tx.assetIn;
			const receivedAmount = tx.rawAmountOut || tx.amountOut;
			const receivedCurrency = tx.assetOut;
			const label = tx.type === 'swap' ? '' : tx.type === 'addLiquidity' ? 'liquidity_in' : tx.type === 'withdraw' ? 'liquidity_out' : '';
			const desc = tx.type === 'swap' ? `Swap ${tx.assetIn} → ${tx.assetOut}` : tx.type === 'addLiquidity' ? `LP Add ${tx.assetIn}` : tx.type === 'withdraw' ? `Withdraw ${tx.assetOut}` : tx.type === 'send' ? `Send ${sentAmount !== '0' ? tx.assetIn : tx.assetOut}` : typeLabels[tx.type] || tx.type;
			return [
				tx.date,
				sentAmount !== '0' ? sentAmount : '',
				sentAmount !== '0' ? sentCurrency : '',
				receivedAmount !== '0' ? receivedAmount : '',
				receivedAmount !== '0' ? receivedCurrency : '',
				tx.feeAmount || '',
				tx.feeCurrency || '',
				'', '',
				label,
				desc,
				tx.txID || ''
			];
		});
		const csv = [headers, ...rows].map((r: string[]) =>
			r.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(',')
		).join('\n');

		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `ozone-koinly-${data.reportId}-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const generatedDate = $derived(data.generated ? new Date(data.generated).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null);
	const dateFromFmt = $derived(data.dateFrom ? new Date(data.dateFrom).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null);
	const dateToFmt = $derived(data.dateTo ? new Date(data.dateTo).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null);
</script>

<svelte:head>
	<title>Report {data.reportId} — Ozone</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-20 pb-16">
	<!-- Header -->
	<div class="text-center mb-8">
		<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4" style="background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.2);">
			<span class="text-[10px] font-mono" style="color: #22d3ee;">Shared Report</span>
		</div>
		<h1 class="text-3xl sm:text-4xl font-bold tracking-tight mb-2" style="color: var(--text);">Transaction Report</h1>
		<p class="text-sm font-mono mb-1" style="color: var(--text-muted);">{data.reportId}</p>

		<div class="flex items-center justify-center gap-3 text-[11px] mt-2" style="color: var(--text-faint);">
			{#if generatedDate}
				<span>Generated {generatedDate}</span>
			{/if}
			{#if dateFromFmt || dateToFmt}
				<span>&middot;</span>
				<span>
					{#if dateFromFmt && dateToFmt}
						{dateFromFmt} — {dateToFmt}
					{:else if dateFromFmt}
						From {dateFromFmt}
					{:else if dateToFmt}
						Until {dateToFmt}
					{/if}
				</span>
			{/if}
			{#if data.includeNew}
				<span>&middot;</span>
				<span class="inline-flex items-center gap-1">
					<span class="live-dot"></span> Live
				</span>
			{/if}
		</div>
	</div>

	<!-- Info banner -->
	<div class="rpt-card rounded-xl p-4 mb-6 max-w-2xl mx-auto" style="border-color: rgba(34,211,238,0.2);">
		<div class="flex items-start gap-3">
			<span class="text-sm mt-0.5" style="color: #22d3ee;">&#9432;</span>
			<div>
				<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
					This is a shared transaction report from <strong style="color: var(--text);">Ozone</strong>.
					{#if data.revealWallet && data.address}
						The report owner chose to reveal their wallet address.
					{:else}
						It shows THORChain transaction history without revealing the source address.
					{/if}
					{#if data.includeNew}
						This is a <strong style="color: #22d3ee;">live report</strong> — it automatically includes new transactions each time you view it.
					{:else}
						This is a <strong style="color: var(--text);">snapshot</strong> — it shows transactions as of the date it was generated.
					{/if}
				</p>
			</div>
		</div>
	</div>

	<!-- Actions -->
	<div class="flex justify-center gap-2 mb-6">
		<button onclick={exportCSV} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="background: var(--app-accent); color: white;">
			Export CSV
		</button>
		<button onclick={exportKoinlyCSV} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); color: var(--app-accent);">
			Koinly CSV
		</button>
		<a href="/history" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
			Generate your own
		</a>
	</div>

	<!-- Address + Balances -->
	{#if data.revealWallet && data.address}
		<div class="rpt-card rounded-xl p-4 mb-6">
			<div class="text-[10px] mb-2" style="color: var(--text-faint);">WALLET</div>
			<div class="text-sm font-mono break-all" style="color: var(--text);">{data.address}</div>
			{#if data.balances && data.balances.length > 0}
				<div class="text-[10px] mt-4 mb-2" style="color: var(--text-faint);">BALANCES AT TIME OF REPORT</div>
				<div class="flex flex-wrap gap-2">
					{#each data.balances as bal}
						
						<span class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-mono" style="background: rgba(99,102,241,0.06); border: 1px solid var(--app-border-subtle);">
							{#if logo(bal.asset.toUpperCase())}
								<img src={logo(bal.asset.toUpperCase())} alt={bal.asset} class="w-3.5 h-3.5 rounded-full" />
							{/if}
							<span style="color: var(--text);">{bal.amount}</span>
							<span style="color: var(--text-faint);">{bal.asset.toUpperCase()}</span>
						</span>
					{/each}
				</div>
			{/if}
		</div>
	{:else if data.balances && data.balances.length > 0}
		<div class="rpt-card rounded-xl p-4 mb-6">
			<div class="text-[10px] mb-2" style="color: var(--text-faint);">BALANCES AT TIME OF REPORT</div>
			<div class="flex flex-wrap gap-2">
				{#each data.balances as bal}
					
					<span class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-mono" style="background: rgba(99,102,241,0.06); border: 1px solid var(--app-border-subtle);">
						{#if logo(bal.asset.toUpperCase())}
							<img src={logo(bal.asset.toUpperCase())} alt={bal.asset} class="w-3.5 h-3.5 rounded-full" />
						{/if}
						<span style="color: var(--text);">{bal.amount}</span>
						<span style="color: var(--text-faint);">{bal.asset.toUpperCase()}</span>
					</span>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Stats row -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
		<div class="rpt-card rounded-xl p-4">
			<div class="text-xl font-bold font-mono" style="color: var(--app-accent);">{txSwaps}</div>
			<div class="text-[10px]" style="color: var(--text-muted);">Swaps</div>
		</div>
		<div class="rpt-card rounded-xl p-4">
			<div class="text-xl font-bold font-mono" style="color: #10b981;">{txAdds}</div>
			<div class="text-[10px]" style="color: var(--text-muted);">LP Adds</div>
		</div>
		<div class="rpt-card rounded-xl p-4">
			<div class="text-xl font-bold font-mono" style="color: #f59e0b;">{txWithdraws}</div>
			<div class="text-[10px]" style="color: var(--text-muted);">Withdrawals</div>
		</div>
		<div class="rpt-card rounded-xl p-4">
			<div class="text-xl font-bold font-mono" style="color: #22d3ee;">{txSends}</div>
			<div class="text-[10px]" style="color: var(--text-muted);">Sends</div>
		</div>
	</div>

	<!-- Transaction Table -->
	<div class="overflow-x-auto rounded-xl" style="background: var(--bg-card); border: 1px solid var(--app-border);">
		<table class="w-full text-left text-sm">
			<thead>
				<tr style="border-bottom: 1px solid var(--app-border);">
					<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);">Date</th>
					<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);">Type</th>
					<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);">In</th>
					<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);">Out</th>
					<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);">Status</th>
					{#if data.revealWallet}
						<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);"></th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each data.transactions as tx}
					<tr style="border-bottom: 1px solid var(--app-border-subtle);">
						<td class="px-4 py-2.5 text-xs" style="color: var(--text-muted);">
							{tx.date ? new Date(tx.date).toLocaleDateString() : '--'}
						</td>
						<td class="px-4 py-2.5">
							<span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background: {typeColors[tx.type] || 'var(--text-ghost)'}15; color: {typeColors[tx.type] || 'var(--text-ghost)'};">
								{typeLabels[tx.type] || tx.type}
							</span>
						</td>
						<td class="px-4 py-2.5 text-xs font-mono" style="color: var(--text);">
							{#if tx.amountIn !== '0'}
								<span class="inline-flex items-center gap-1.5">
									
									{#if logo(tx.assetIn)}
										<img src={logo(tx.assetIn)} alt={tx.assetIn} class="w-4 h-4 rounded-full" />
									{/if}
									{tx.amountIn} <span style="color: var(--text-faint);">{tx.assetIn}</span>
								</span>
							{:else}--{/if}
						</td>
						<td class="px-4 py-2.5 text-xs font-mono" style="color: var(--text);">
							{#if tx.amountOut !== '0'}
								<span class="inline-flex items-center gap-1.5">
									
									{#if logo(tx.assetOut)}
										<img src={logo(tx.assetOut)} alt={tx.assetOut} class="w-4 h-4 rounded-full" />
									{/if}
									{tx.amountOut} <span style="color: var(--text-faint);">{tx.assetOut}</span>
								</span>
							{:else}--{/if}
						</td>
						<td class="px-4 py-2.5">
							<span class="text-[10px]" style="color: {tx.status === 'success' ? '#10b981' : '#f59e0b'};">
								{tx.status}
							</span>
						</td>
						{#if data.revealWallet}
							<td class="px-4 py-2.5">
								{#if tx.txID}
									<a href="https://runescan.io/tx/{tx.txID}" target="_blank" rel="noopener" class="text-[10px] transition-colors" style="color: var(--text-ghost);" title="View on RuneScan">&#8599;</a>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
				{#if data.transactions.length === 0}
					<tr>
						<td colspan={data.revealWallet ? 6 : 5} class="px-4 py-12 text-center text-sm" style="color: var(--text-muted);">
							No transactions found.
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Footer -->
	<div class="text-center mt-8">
		<p class="text-[10px]" style="color: var(--text-faint);">
			{data.totalTransactions} transactions
			{#if data.revealWallet && data.address}
				&middot; {data.address}
			{:else}
				&middot; Source address hidden for privacy
			{/if}
			&middot; Powered by <a href="/" class="underline" style="color: var(--text-ghost);">Ozone</a>
		</p>
	</div>
</div>

<style>
	.rpt-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
	}
	.live-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #22d3ee;
		box-shadow: 0 0 6px #22d3ee;
		animation: live-pulse 2s ease-in-out infinite;
	}
	@keyframes live-pulse {
		0%, 100% { opacity: 1; box-shadow: 0 0 6px #22d3ee; }
		50% { opacity: 0.5; box-shadow: 0 0 12px #22d3ee; }
	}
</style>
