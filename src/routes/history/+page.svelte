<script lang="ts">
	import { fetchPoolAssets, getTokenLogoSync } from '$lib/utils/tokenLogos';

	let address = $state('');
	let phase = $state<'idle' | 'loading' | 'done'>('idle');
	let loadStep = $state(0);
	let report = $state<any>(null);
	let error = $state('');
	let copied = $state(false);
	let poolAssets = $state<string[]>([]);

	// Share options
	let dateFrom = $state('');
	let dateTo = $state('');
	let includeNew = $state(false);
	let revealWallet = $state(false);
	let showShareOpts = $state(false);

	// Load pool assets on mount for dynamic logo resolution
	fetchPoolAssets().then((assets) => { poolAssets = assets; });

	function logo(symbol: string): string | undefined {
		return getTokenLogoSync(symbol, poolAssets);
	}

	const LOAD_STEPS = [
		'Connecting to THORChain...',
		'Fetching transaction history...',
		'Parsing swap routes...',
		'Mapping L1 addresses...',
		'Fetching balances...',
		'Compiling report...',
	];

	const typeLabels: Record<string, string> = {
		swap: 'Swap', addLiquidity: 'Add LP', withdraw: 'Withdraw', send: 'Send', refund: 'Refund',
		switch: 'Switch', contract: 'Contract', donate: 'Donate',
	};
	const typeColors: Record<string, string> = {
		swap: 'var(--app-accent)', addLiquidity: '#10b981', withdraw: '#f59e0b', send: '#22d3ee', refund: '#ef4444',
		switch: '#a78bfa', contract: '#64748b', donate: '#f472b6',
	};

	async function fetchHistory() {
		if (!address.trim() || !address.startsWith('thor')) {
			error = 'Please enter a valid thor1... address';
			return;
		}
		phase = 'loading';
		loadStep = 0;
		error = '';
		report = null;

		for (let i = 0; i < LOAD_STEPS.length - 1; i++) {
			loadStep = i;
			await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
		}

		try {
			const body: any = { address: address.trim() };
			if (dateFrom) body.dateFrom = dateFrom;
			if (dateTo) body.dateTo = dateTo;
			if (includeNew) body.includeNew = true;
			if (revealWallet) body.revealWallet = true;

			const res = await fetch('/api/history', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (data.error) {
				error = data.error;
				phase = 'idle';
				return;
			}
			report = data;
		} catch {
			error = 'Failed to fetch transaction history';
			phase = 'idle';
			return;
		}

		loadStep = LOAD_STEPS.length - 1;
		await new Promise(r => setTimeout(r, 500));
		phase = 'done';
	}

	function exportCSV() {
		if (!report) return;
		const headers = ['Date', 'Type', 'Asset In', 'Amount In', 'Asset Out', 'Amount Out', 'Fee Amount', 'Fee Currency', 'From', 'To', 'TxID', 'Status'];
		const rows = report.transactions.map((tx: any) => [
			tx.date, tx.type, tx.assetIn, tx.rawAmountIn || tx.amountIn, tx.assetOut, tx.rawAmountOut || tx.amountOut, tx.feeAmount || '', tx.feeCurrency || '', tx.from, tx.to, tx.txID, tx.status
		]);
		const csv = [headers, ...rows].map((r: string[]) =>
			r.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(',')
		).join('\n');

		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `ozone-history-${report.reportId}-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportKoinlyCSV() {
		if (!report) return;
		const headers = ['Date', 'Sent Amount', 'Sent Currency', 'Received Amount', 'Received Currency', 'Fee Amount', 'Fee Currency', 'Net Worth Amount', 'Net Worth Currency', 'Label', 'Description', 'TxHash'];
		const rows = report.transactions.map((tx: any) => {
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
		a.download = `ozone-koinly-${report.reportId}-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function copyShareLink() {
		if (!report?.shareUrl) return;
		const fullUrl = `${window.location.origin}${report.shareUrl}`;
		await navigator.clipboard.writeText(fullUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function reset() {
		phase = 'idle';
		report = null;
		error = '';
		showShareOpts = false;
		activeFilter = null;
	}

	function truncAddr(a: string): string {
		if (!a || a.length <= 16) return a || '';
		return `${a.slice(0, 8)}...${a.slice(-6)}`;
	}

	// Type filter
	let activeFilter = $state<string | null>(null);

	function getAllTypes(): string[] {
		if (!report?.transactions) return [];
		const set = new Set<string>();
		for (const tx of report.transactions) set.add(tx.type);
		return [...set];
	}

	const filteredTxs = $derived(
		activeFilter
			? report?.transactions?.filter((t: any) => t.type === activeFilter) || []
			: report?.transactions || []
	);

	const txSwaps = $derived(report?.transactions?.filter((t: any) => t.type === 'swap').length || 0);
	const txAdds = $derived(report?.transactions?.filter((t: any) => t.type === 'addLiquidity').length || 0);
	const txWithdraws = $derived(report?.transactions?.filter((t: any) => t.type === 'withdraw').length || 0);
	const txSends = $derived(report?.transactions?.filter((t: any) => t.type === 'send').length || 0);
</script>

<svelte:head>
	<title>Wallet Explorer — Ozone</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-20 pb-16">
	{#if phase === 'idle'}
		<!-- Header -->
		<div class="text-center mb-10">
			<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);">
				<span class="text-[10px] font-mono" style="color: var(--app-accent);">Private &middot; Shareable &middot; Exportable</span>
			</div>
			<h1 class="text-3xl sm:text-4xl font-bold tracking-tight mb-3" style="color: var(--text);">Wallet Explorer</h1>
			<p class="text-sm max-w-lg mx-auto" style="color: var(--text-muted);">
				Explore any THORChain wallet's full transaction history. Export for taxes (Koinly CSV), share via anonymous link, or view on-chain activity — no login required.
			</p>
		</div>

		<!-- Input card -->
		<div class="hist-card rounded-2xl p-6 sm:p-8 max-w-xl mx-auto mb-4">
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={address}
					placeholder="thor1..."
					class="hist-input flex-1 rounded-xl px-4 py-3 text-sm font-mono"
					onkeydown={(e) => { if (e.key === 'Enter') fetchHistory(); }}
				/>
				<button
					onclick={fetchHistory}
					disabled={!address.trim()}
					class="rounded-xl px-6 py-3 text-sm font-semibold text-white disabled:opacity-30 transition-all"
					style="background: var(--app-accent);"
				>
					Fetch
				</button>
			</div>

			<!-- Report options (always visible) -->
			<div class="mt-4 pt-4 space-y-3" style="border-top: 1px solid var(--app-border-subtle);">
				<!-- Date range -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label class="text-[10px] block mb-1" style="color: var(--text-faint);">From date</label>
						<input type="date" bind:value={dateFrom} class="hist-input w-full rounded-lg px-3 py-2 text-xs" />
					</div>
					<div>
						<label class="text-[10px] block mb-1" style="color: var(--text-faint);">To date</label>
						<input type="date" bind:value={dateTo} class="hist-input w-full rounded-lg px-3 py-2 text-xs" />
					</div>
				</div>
				<p class="text-[9px]" style="color: var(--text-faint);">Leave empty for full history.</p>

				<!-- Privacy -->
				<div>
					<div class="text-[10px] mb-1.5" style="color: var(--text-faint);">Visibility</div>
					<div class="grid grid-cols-2 rounded-lg overflow-hidden" style="border: 1px solid var(--app-border);">
						<button onclick={() => revealWallet = false} class="px-3 py-2 text-[11px] font-medium transition-all" style="{!revealWallet ? 'background: var(--app-accent); color: white;' : 'color: var(--text-muted);'}">
							Private
						</button>
						<button onclick={() => revealWallet = true} class="px-3 py-2 text-[11px] font-medium transition-all" style="{revealWallet ? 'background: var(--app-accent); color: white;' : 'color: var(--text-muted);'}">
							Public
						</button>
					</div>
					<p class="text-[9px] mt-1" style="color: var(--text-faint);">{revealWallet ? 'Wallet address & tx links visible in report' : 'Wallet address & tx links hidden in report'}</p>
				</div>

				<!-- Update mode -->
				<div>
					<div class="text-[10px] mb-1.5" style="color: var(--text-faint);">Update mode</div>
					<div class="grid grid-cols-2 rounded-lg overflow-hidden" style="border: 1px solid var(--app-border);">
						<button onclick={() => includeNew = false} class="px-3 py-2 text-[11px] font-medium transition-all" style="{!includeNew ? 'background: #22d3ee; color: #0f172a;' : 'color: var(--text-muted);'}">
							Snapshot
						</button>
						<button onclick={() => includeNew = true} class="px-3 py-2 text-[11px] font-medium transition-all" style="{includeNew ? 'background: #22d3ee; color: #0f172a;' : 'color: var(--text-muted);'}">
							Live
						</button>
					</div>
					<p class="text-[9px] mt-1" style="color: var(--text-faint);">{includeNew ? 'Report auto-updates with new transactions' : 'Report is fixed at creation time'}</p>
				</div>
			</div>

			{#if error}
				<p class="text-xs mt-3 text-center" style="color: #ef4444;">{error}</p>
			{/if}
		</div>

		<!-- Explanation section -->
		<div class="max-w-xl mx-auto mt-8">
			<h2 class="text-sm font-semibold mb-4" style="color: var(--text);">How it works</h2>
			<div class="grid gap-3">
				<div class="hist-card rounded-xl p-4 flex items-start gap-3">
					<span class="text-sm mt-0.5 shrink-0" style="color: var(--app-accent);">1</span>
					<div>
						<p class="text-xs font-medium mb-0.5" style="color: var(--text);">Enter your address</p>
						<p class="text-[11px] leading-relaxed" style="color: var(--text-muted);">Paste your <code class="text-[10px] px-1 py-0.5 rounded" style="background: var(--bg-code);">thor1...</code> address. We query THORChain's indexer directly — no data is stored on our servers beyond the shareable report.</p>
					</div>
				</div>
				<div class="hist-card rounded-xl p-4 flex items-start gap-3">
					<span class="text-sm mt-0.5 shrink-0" style="color: var(--app-accent);">2</span>
					<div>
						<p class="text-xs font-medium mb-0.5" style="color: var(--text);">Review your history</p>
						<p class="text-[11px] leading-relaxed" style="color: var(--text-muted);">See all swaps, LP adds, withdrawals, and sends with full asset details. Filter by date range if you only need a specific period.</p>
					</div>
				</div>
				<div class="hist-card rounded-xl p-4 flex items-start gap-3">
					<span class="text-sm mt-0.5 shrink-0" style="color: var(--app-accent);">3</span>
					<div>
						<p class="text-xs font-medium mb-0.5" style="color: var(--text);">Export or share</p>
						<p class="text-[11px] leading-relaxed" style="color: var(--text-muted);">Download as CSV for tax reporting, or copy the shareable link. Choose whether to reveal your address or keep it private — if hidden, transaction links are also removed.</p>
					</div>
				</div>
			</div>

			<div class="hist-card rounded-xl p-4 mt-3">
				<p class="text-[11px] leading-relaxed" style="color: var(--text-muted);">
					<strong style="color: var(--text);">Static vs Live reports:</strong> By default, reports are a snapshot at the time of creation. Enable "Live report" to create a link that always shows the latest transactions — useful for ongoing monitoring or sharing with someone who needs up-to-date data.
				</p>
			</div>
		</div>

	{:else if phase === 'loading'}
		<!-- Loading -->
		<div class="text-center mb-8">
			<h2 class="text-xl font-bold mb-2" style="color: var(--text);">Fetching history</h2>
			<p class="text-xs font-mono" style="color: var(--text-muted);">{truncAddr(address)}</p>
		</div>
		<div class="hist-card rounded-2xl p-6 sm:p-8 max-w-xl mx-auto">
			{#each LOAD_STEPS as step, i}
				<div class="flex items-center gap-3 py-2.5" style="opacity: {i <= loadStep ? 1 : 0.2}; transition: opacity 0.3s;">
					{#if i < loadStep}
						<span style="color: #10b981;">&#10003;</span>
					{:else if i === loadStep}
						<span class="scan-spinner"></span>
					{:else}
						<span class="inline-block w-4 h-4 rounded-full" style="background: var(--app-border);"></span>
					{/if}
					<span class="text-sm" style="color: {i <= loadStep ? 'var(--text)' : 'var(--text-ghost)'};">{step}</span>
				</div>
			{/each}
			<div class="mt-4 h-1 rounded-full overflow-hidden" style="background: var(--app-border);">
				<div class="h-full rounded-full transition-all duration-500" style="background: var(--app-accent); width: {((loadStep + 1) / LOAD_STEPS.length) * 100}%;"></div>
			</div>
		</div>

	{:else if phase === 'done' && report}
		<!-- Results -->
		<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
			<div>
				<h1 class="text-2xl font-bold" style="color: var(--text);">Transaction Report</h1>
				<p class="text-sm mt-1" style="color: var(--text-muted);">
					{report.totalTransactions} transactions &middot; {report.reportId}
					{#if report.includeNew}
						&middot; <span style="color: #22d3ee;">Live</span>
					{/if}
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button onclick={copyShareLink} class="rounded-lg px-4 py-2 text-xs font-medium transition-all flex items-center gap-1.5" style="background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.2); color: #22d3ee;">
					{#if copied}
						&#10003; Copied!
					{:else}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
						Copy share link
					{/if}
				</button>
				<button onclick={exportCSV} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="background: var(--app-accent); color: white;">
					Export CSV
				</button>
				<button onclick={exportKoinlyCSV} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); color: var(--app-accent);">
					Koinly CSV
				</button>
				<button onclick={reset} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
					New report
				</button>
			</div>
		</div>

		<!-- Share info -->
		{#if report.shareUrl}
			<div class="hist-card rounded-xl p-3 mb-6 flex items-center gap-3" style="border-color: rgba(34,211,238,0.15);">
				<span class="text-xs" style="color: #22d3ee;">&#128279;</span>
				<div class="flex-1 min-w-0">
					<p class="text-[11px] font-mono truncate" style="color: var(--text-muted);">
						{window.location.origin}{report.shareUrl}
					</p>
				</div>
				<button onclick={copyShareLink} class="text-[10px] font-medium shrink-0 px-2 py-1 rounded-lg transition-all" style="color: #22d3ee; background: rgba(34,211,238,0.08);">
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
		{/if}

		<!-- Balances -->
		{#if report.balances && report.balances.length > 0}
			<div class="hist-card rounded-xl p-4 mb-6">
				<div class="text-[10px] mb-2" style="color: var(--text-faint);">BALANCES AT TIME OF REPORT</div>
				<div class="flex flex-wrap gap-2">
					{#each report.balances as bal}
						
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

		<!-- Stats row (clickable filters) -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
			<button onclick={() => (activeFilter = activeFilter === 'swap' ? null : 'swap')} class="hist-card rounded-xl p-4 text-left transition-all" style="{activeFilter === 'swap' ? 'border-color: var(--app-accent); box-shadow: 0 0 12px rgba(99,102,241,0.15);' : ''} cursor: pointer;">
				<div class="text-xl font-bold font-mono" style="color: var(--app-accent);">{txSwaps}</div>
				<div class="text-[10px]" style="color: var(--text-muted);">Swaps</div>
			</button>
			<button onclick={() => (activeFilter = activeFilter === 'addLiquidity' ? null : 'addLiquidity')} class="hist-card rounded-xl p-4 text-left transition-all" style="{activeFilter === 'addLiquidity' ? 'border-color: #10b981; box-shadow: 0 0 12px rgba(16,185,129,0.15);' : ''} cursor: pointer;">
				<div class="text-xl font-bold font-mono" style="color: #10b981;">{txAdds}</div>
				<div class="text-[10px]" style="color: var(--text-muted);">LP Adds</div>
			</button>
			<button onclick={() => (activeFilter = activeFilter === 'withdraw' ? null : 'withdraw')} class="hist-card rounded-xl p-4 text-left transition-all" style="{activeFilter === 'withdraw' ? 'border-color: #f59e0b; box-shadow: 0 0 12px rgba(245,158,11,0.15);' : ''} cursor: pointer;">
				<div class="text-xl font-bold font-mono" style="color: #f59e0b;">{txWithdraws}</div>
				<div class="text-[10px]" style="color: var(--text-muted);">Withdrawals</div>
			</button>
			<button onclick={() => (activeFilter = activeFilter === 'send' ? null : 'send')} class="hist-card rounded-xl p-4 text-left transition-all" style="{activeFilter === 'send' ? 'border-color: #22d3ee; box-shadow: 0 0 12px rgba(34,211,238,0.15);' : ''} cursor: pointer;">
				<div class="text-xl font-bold font-mono" style="color: #22d3ee;">{txSends}</div>
				<div class="text-[10px]" style="color: var(--text-muted);">Sends</div>
			</button>
		</div>

		<!-- Filter pills -->
		<div class="flex flex-wrap items-center gap-2 mb-6">
			<button
				onclick={() => (activeFilter = null)}
				class="text-[10px] font-medium px-3 py-1 rounded-full transition-all"
				style="{activeFilter === null ? 'background: var(--app-accent); color: white;' : 'background: var(--card-bg); border: 1px solid var(--app-border); color: var(--text-muted);'}"
			>
				All ({report.totalTransactions})
			</button>
			{#each getAllTypes() as t}
				{@const color = typeColors[t] || 'var(--text-ghost)'}
				{#if !['swap', 'addLiquidity', 'withdraw', 'send'].includes(t)}
					<button
						onclick={() => (activeFilter = activeFilter === t ? null : t)}
						class="text-[10px] font-medium px-3 py-1 rounded-full transition-all"
						style="{activeFilter === t ? `background: ${color}; color: white;` : `background: ${color}10; border: 1px solid ${color}30; color: ${color};`}"
					>
						{typeLabels[t] || t} ({report.transactions.filter((tx: any) => tx.type === t).length})
					</button>
				{/if}
			{/each}
			{#if activeFilter}
				<span class="text-[10px]" style="color: var(--text-faint);">
					Showing {filteredTxs.length} of {report.totalTransactions}
				</span>
			{/if}
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
						<th class="px-4 py-3 font-medium text-xs" style="color: var(--text-muted);"></th>
					</tr>
				</thead>
				<tbody>
					{#each filteredTxs as tx}
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
							<td class="px-4 py-2.5">
								{#if tx.txID}
									<a href="https://runescan.io/tx/{tx.txID}" target="_blank" rel="noopener" class="text-[10px] transition-colors" style="color: var(--text-ghost);" title="View on RuneScan">&#8599;</a>
								{/if}
							</td>
						</tr>
					{/each}
					{#if filteredTxs.length === 0}
						<tr>
							<td colspan="6" class="px-4 py-12 text-center text-sm" style="color: var(--text-muted);">
								{activeFilter ? 'No transactions match this filter.' : 'No transactions found for this address.'}
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.hist-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
	}
	.hist-input {
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		color: var(--text);
		outline: none;
	}
	.hist-input:focus { border-color: var(--app-accent); }
	.hist-input::placeholder { color: var(--input-placeholder); }
	.scan-spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid var(--app-border);
		border-top-color: var(--app-accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
