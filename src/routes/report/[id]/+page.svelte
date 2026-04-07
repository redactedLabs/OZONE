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
		// FIN — Orderbook
		'fin-trade': 'Trade', 'fin-arb': 'Arb',
		'fin-order': 'Limit Order', 'fin-order-wd': 'Claim Order',
		'fin-order-inc': 'Increase Order', 'fin-order-dec': 'Cancel Order',
		'fin-mm-fee': 'MM Fee',
		// FIN Range — Concentrated Liquidity
		'fin-range': 'Range Create', 'fin-range-dep': 'Range Deposit',
		'fin-range-wd': 'Range Withdraw', 'fin-range-claim': 'Range Claim',
		'fin-range-close': 'Range Close', 'fin-range-xfer': 'Range Transfer',
		'fin-range-fee': 'Range Fee',
		// BOW — AMM
		'bow-swap': 'AMM Swap', 'bow-deposit': 'AMM Deposit', 'bow-withdraw': 'AMM Withdraw',
		// TC Swap
		'tc-swap': 'Swap (TC)',
		// Ghost Vault — Lending
		'ghost-borrow': 'Borrow', 'ghost-repay': 'Repay',
		'ghost-lend': 'Lend', 'ghost-withdraw': 'Withdraw Lend',
		// Ghost Credit — Credit Accounts
		'ghost-credit-create': 'Credit Account', 'ghost-credit-action': 'Credit Action',
		'ghost-credit-borrow': 'Credit Borrow', 'ghost-credit-repay': 'Credit Repay',
		'ghost-credit-send': 'Credit Send', 'ghost-credit-exec': 'Credit Execute',
		'ghost-liquidation': 'Liquidation',
		// CALC — DCA
		'calc-init': 'DCA Create', 'calc-process': 'DCA Execute',
		'calc-withdraw': 'DCA Withdraw', 'calc-create': 'DCA Strategy',
		'calc-internal': 'DCA (step)', 'calc-update': 'DCA Update',
		// AutoRujira
		'auto-workflow': 'Auto Workflow', 'auto-cancel': 'Cancel Workflow',
		'auto-config': 'Auto Config', 'auto-fee-wd': 'Auto Fee WD',
		// System
		'deferred-exec': 'Deferred Exec', 'crank-fee': 'Crank Fee',
		// Staking
		'ruji-stake': 'RUJI Stake', 'ruji-unstake': 'RUJI Unstake', 'ruji-claim': 'RUJI Claim',
		// Pilot — Liquidations
		'pilot-swap': 'Liquidation Swap', 'pilot-order': 'Liquidation Bid',
		// Liquidy
		'liquidy-swap': 'Liquidy Swap', 'liquidy-exec': 'Liquidy Execute',
		// BRUNE
		'brune-swap': 'BRUNE Swap', 'brune-mint': 'BRUNE Mint', 'brune-burn': 'BRUNE Burn',
		'brune-bond': 'BRUNE Bond', 'brune-fee': 'BRUNE Fee',
		// Nami Index
		'nami-deposit': 'Index Deposit', 'nami-withdraw': 'Index Withdraw',
		// Other
		'revenue-run': 'Revenue Dist', 'merge-deposit': 'Merge', 'merge-withdraw': 'Merge Out',
		'secure': 'Secure', 'tcy_stake': 'TCY Stake', 'tcy_unstake': 'TCY Unstake',
	};
	const typeColors: Record<string, string> = {
		swap: 'var(--app-accent)', addLiquidity: '#10b981', withdraw: '#f59e0b', send: '#22d3ee', refund: '#ef4444',
		switch: '#a78bfa', contract: '#64748b', donate: '#f472b6',
		'fin-trade': '#f59e0b', 'fin-arb': '#f97316',
		'fin-order': '#f59e0b', 'fin-order-wd': '#f59e0b',
		'fin-order-inc': '#f59e0b', 'fin-order-dec': '#f59e0b',
		'fin-mm-fee': '#f97316',
		'fin-range': '#10b981', 'fin-range-dep': '#10b981',
		'fin-range-wd': '#10b981', 'fin-range-claim': '#10b981',
		'fin-range-close': '#10b981', 'fin-range-xfer': '#10b981',
		'fin-range-fee': '#10b981',
		'bow-swap': '#6366f1', 'bow-deposit': '#6366f1', 'bow-withdraw': '#6366f1',
		'tc-swap': '#6366f1',
		'ghost-borrow': '#ef4444', 'ghost-repay': '#22c55e',
		'ghost-lend': '#6366f1', 'ghost-withdraw': '#a78bfa',
		'ghost-credit-create': '#8b5cf6', 'ghost-credit-action': '#8b5cf6',
		'ghost-credit-borrow': '#ef4444', 'ghost-credit-repay': '#22c55e',
		'ghost-credit-send': '#8b5cf6', 'ghost-credit-exec': '#8b5cf6',
		'ghost-liquidation': '#ef4444',
		'calc-init': '#a78bfa', 'calc-process': '#a78bfa',
		'calc-withdraw': '#a78bfa', 'calc-create': '#a78bfa',
		'calc-internal': '#94a3b8', 'calc-update': '#94a3b8',
		'auto-workflow': '#94a3b8', 'auto-cancel': '#94a3b8',
		'auto-config': '#94a3b8', 'auto-fee-wd': '#94a3b8',
		'deferred-exec': '#64748b', 'crank-fee': '#64748b',
		'ruji-stake': '#10b981', 'ruji-unstake': '#f59e0b', 'ruji-claim': '#10b981',
		'pilot-swap': '#ef4444', 'pilot-order': '#ef4444',
		'liquidy-swap': '#22d3ee', 'liquidy-exec': '#22d3ee',
		'brune-swap': '#f97316', 'brune-mint': '#f97316', 'brune-burn': '#f97316',
		'brune-bond': '#f97316', 'brune-fee': '#94a3b8',
		'nami-deposit': '#3b82f6', 'nami-withdraw': '#3b82f6',
		'revenue-run': '#94a3b8', 'merge-deposit': '#94a3b8', 'merge-withdraw': '#94a3b8',
		'secure': '#3b82f6', 'tcy_stake': '#10b981', 'tcy_unstake': '#f59e0b',
	};

	// Filter state
	let activeFilter = $state('');

	// Count transactions by type (across all txs, not just groups)
	const typeCounts = $derived(() => {
		const counts: Record<string, number> = {};
		for (const tx of (data.transactions || [])) {
			counts[tx.type] = (counts[tx.type] || 0) + 1;
		}
		return counts;
	});

	// Filtered transactions
	const filteredTxs = $derived(() => {
		const txs = data.transactions || [];
		if (!activeFilter) return txs;
		return txs.filter((tx: any) => tx.type === activeFilter);
	});

	// Group transactions by txID — sibling contract events collapse under one row
	const GROUP_PRIORITY: Record<string, number> = {
		'swap': 1, 'addLiquidity': 2, 'withdraw': 3, 'send': 4, 'refund': 5,
		'switch': 6, 'secure': 7, 'tcy_stake': 8, 'tcy_unstake': 9, 'donate': 10,
		'calc-create': 15, 'calc-update': 16, 'calc-withdraw': 17,
		'fin-order': 18, 'fin-order-wd': 19, 'fin-order-inc': 18, 'fin-order-dec': 19,
		'fin-range': 20, 'fin-range-dep': 20, 'fin-range-wd': 20,
		'fin-range-claim': 20, 'fin-range-close': 20, 'fin-range-xfer': 20,
		'ghost-lend': 21, 'ghost-withdraw': 22,
		'ghost-credit-create': 23, 'ghost-credit-borrow': 24, 'ghost-credit-repay': 25,
		'ghost-credit-send': 26, 'ghost-credit-exec': 27, 'ghost-credit-action': 28,
		'ghost-liquidation': 24,
		'liquidy-swap': 29,
		'bow-deposit': 30, 'bow-withdraw': 30,
		'auto-workflow': 31, 'auto-cancel': 32,
		'auto-config': 40, 'auto-fee-wd': 40,
		'ruji-stake': 33, 'ruji-unstake': 33, 'ruji-claim': 33,
		'pilot-swap': 34, 'pilot-order': 34,
		'brune-swap': 35, 'brune-mint': 35, 'brune-burn': 35,
		'nami-deposit': 36, 'nami-withdraw': 36,
		'merge-deposit': 37, 'merge-withdraw': 37,
		'tc-swap': 50, 'bow-swap': 51, 'fin-trade': 52,
		'calc-process': 55, 'calc-init': 56, 'calc-internal': 57,
		'liquidy-exec': 58,
		'ghost-borrow': 70, 'ghost-repay': 71,
		'fin-arb': 80, 'fin-range-fee': 81, 'fin-mm-fee': 82,
		'brune-bond': 80, 'brune-fee': 82,
		'deferred-exec': 85, 'crank-fee': 86,
		'revenue-run': 90,
		'contract': 100, 'unknown': 999,
	};

	function groupByTxID(txs: any[]): Array<{ primary: any; siblings: any[]; txID: string }> {
		const groups: Array<{ primary: any; siblings: any[]; txID: string }> = [];
		const idxMap = new Map<string, number>();
		for (const tx of txs) {
			if (!tx.txID) {
				groups.push({ primary: tx, siblings: [], txID: '' });
				continue;
			}
			const idx = idxMap.get(tx.txID);
			if (idx !== undefined) {
				const g = groups[idx];
				const newPri = GROUP_PRIORITY[tx.type] ?? 500;
				const curPri = GROUP_PRIORITY[g.primary.type] ?? 500;
				if (newPri < curPri) {
					g.siblings.push(g.primary);
					g.primary = tx;
				} else {
					g.siblings.push(tx);
				}
			} else {
				idxMap.set(tx.txID, groups.length);
				groups.push({ primary: tx, siblings: [], txID: tx.txID });
			}
		}
		return groups;
	}

	let expandedGroups = $state<Set<string>>(new Set());
	function toggleGroup(txID: string) {
		const next = new Set(expandedGroups);
		if (next.has(txID)) next.delete(txID); else next.add(txID);
		expandedGroups = next;
	}

	const groupedTxs = $derived(groupByTxID(filteredTxs()));

	function exportCSV() {
		if (!data.transactions) return;
		const headers = ['Date', 'Type', 'Asset In', 'Amount In', 'Asset Out', 'Amount Out', 'Fee Amount', 'Fee Currency', 'From', 'To', 'TxID', 'Status', 'Contract'];
		const rows = data.transactions.map((tx: any) => [
			tx.date, tx.type, tx.assetIn, tx.rawAmountIn || tx.amountIn, tx.assetOut, tx.rawAmountOut || tx.amountOut, tx.feeAmount || '', tx.feeCurrency || '', tx.from, tx.to, tx.txID, tx.status, tx.fromLabel || tx.toLabel || ''
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
			const koinlyLabel = (type: string): string => {
				if (['swap', 'fin-trade', 'fin-arb', 'bow-swap', 'tc-swap', 'calc-process'].includes(type)) return '';
				if (type === 'addLiquidity' || type === 'fin-range') return 'liquidity_in';
				if (type === 'withdraw') return 'liquidity_out';
				if (type === 'ghost-borrow') return 'borrow';
				if (type === 'ghost-repay') return 'repay';
				if (type === 'ghost-lend') return 'deposit';
				if (type === 'ghost-withdraw') return 'withdrawal';
				if (type === 'fin-range-fee') return 'income';
				return '';
			};
			const label = koinlyLabel(tx.type);
			const contractName = tx.fromLabel || tx.toLabel || '';
			let desc = tx.type === 'swap' ? `Swap ${tx.assetIn} → ${tx.assetOut}` : tx.type === 'addLiquidity' ? `LP Add ${tx.assetIn}` : tx.type === 'withdraw' ? `Withdraw ${tx.assetOut}` : tx.type === 'send' ? `Send ${sentAmount !== '0' ? tx.assetIn : tx.assetOut}` : typeLabels[tx.type] || tx.type;
			if (contractName) desc += ` [${contractName}]`;
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

	<!-- Filter chips -->
	<div class="flex flex-wrap gap-1.5 mb-4 overflow-x-auto pb-1">
		<button
			onclick={() => activeFilter = ''}
			class="filter-chip"
			class:active={!activeFilter}
		>
			All ({data.transactions?.length || 0})
		</button>
		{#each Object.entries(typeCounts()).sort(([, a], [, b]) => b - a) as [type, count]}
			<button
				onclick={() => activeFilter = activeFilter === type ? '' : type}
				class="filter-chip"
				class:active={activeFilter === type}
				style={activeFilter === type ? `background: ${typeColors[type] || '#64748b'}22; border-color: ${typeColors[type] || '#64748b'}66; color: ${typeColors[type] || '#64748b'};` : ''}
			>
				{typeLabels[type] || type} ({count})
			</button>
		{/each}
	</div>

	<!-- Transaction Table -->
	<div class="overflow-x-auto rounded-xl" style="background: var(--bg-card); border: 1px solid var(--app-border);" data-win-title="Transaction Report">
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
				{#each groupedTxs as group}
					{@const tx = group.primary}
					<tr style="border-bottom: 1px solid var(--app-border-subtle);">
						<td class="px-4 py-2.5 text-xs" style="color: var(--text-muted);">
							{tx.date ? new Date(tx.date).toLocaleDateString() : '--'}
						</td>
						<td class="px-4 py-2.5">
							<span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background: {typeColors[tx.type] || 'var(--text-ghost)'}15; color: {typeColors[tx.type] || 'var(--text-ghost)'};">
								{typeLabels[tx.type] || tx.type}
							</span>
							{#if group.siblings.length > 0}
								<button onclick={() => toggleGroup(group.txID)} class="text-[9px] ml-1 px-1.5 py-0.5 rounded" style="background: rgba(99,102,241,0.1); color: var(--app-accent); border: 1px solid rgba(99,102,241,0.2);">
									{expandedGroups.has(group.txID) ? 'hide' : `+${group.siblings.length}`}
								</button>
							{/if}
							{#if tx.fromLabel || tx.toLabel}
								<span class="block text-[9px] mt-0.5" style="color: var(--text-faint);">
									via {tx.fromLabel || tx.toLabel}
								</span>
							{/if}
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
					{#if group.siblings.length > 0 && expandedGroups.has(group.txID)}
						{#each group.siblings.slice(0, 50) as sib}
							<tr style="border-bottom: 1px solid var(--app-border-subtle); opacity: 0.6;">
								<td class="px-4 py-2 text-xs" style="color: var(--text-muted);">
									<span class="pl-3" style="color: var(--text-ghost);">&#8627;</span>
									{sib.date ? new Date(sib.date).toLocaleDateString() : '--'}
								</td>
								<td class="px-4 py-2">
									<span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="background: {typeColors[sib.type] || 'var(--text-ghost)'}15; color: {typeColors[sib.type] || 'var(--text-ghost)'};">
										{typeLabels[sib.type] || sib.type}
									</span>
									{#if sib.fromLabel || sib.toLabel}
										<span class="block text-[9px] mt-0.5" style="color: var(--text-faint);">
											via {sib.fromLabel || sib.toLabel}
										</span>
									{/if}
								</td>
								<td class="px-4 py-2 text-xs font-mono" style="color: var(--text);">
									{#if sib.amountIn !== '0'}
										<span class="inline-flex items-center gap-1.5">
											{#if logo(sib.assetIn)}
												<img src={logo(sib.assetIn)} alt={sib.assetIn} class="w-3.5 h-3.5 rounded-full" />
											{/if}
											{sib.amountIn} <span style="color: var(--text-faint);">{sib.assetIn}</span>
										</span>
									{:else}--{/if}
								</td>
								<td class="px-4 py-2 text-xs font-mono" style="color: var(--text);">
									{#if sib.amountOut !== '0'}
										<span class="inline-flex items-center gap-1.5">
											{#if logo(sib.assetOut)}
												<img src={logo(sib.assetOut)} alt={sib.assetOut} class="w-3.5 h-3.5 rounded-full" />
											{/if}
											{sib.amountOut} <span style="color: var(--text-faint);">{sib.assetOut}</span>
										</span>
									{:else}--{/if}
								</td>
								<td class="px-4 py-2">
									<span class="text-[9px]" style="color: {sib.status === 'success' ? '#10b981' : '#f59e0b'};">
										{sib.status}
									</span>
								</td>
								{#if data.revealWallet}
									<td class="px-4 py-2"></td>
								{/if}
							</tr>
						{/each}
						{#if group.siblings.length > 50}
							<tr style="border-bottom: 1px solid var(--app-border-subtle); opacity: 0.4;">
								<td colspan={data.revealWallet ? 6 : 5} class="px-4 py-2 text-center text-[10px]" style="color: var(--text-faint);">
									... and {group.siblings.length - 50} more sub-transactions
								</td>
							</tr>
						{/if}
					{/if}
				{/each}
				{#if groupedTxs.length === 0}
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
	.filter-chip {
		padding: 3px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 500;
		background: transparent;
		border: 1px solid var(--app-border);
		color: var(--text-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}
	.filter-chip:hover {
		border-color: var(--text-ghost);
		color: var(--text);
	}
	.filter-chip.active {
		background: rgba(99,102,241,0.1);
		border-color: rgba(99,102,241,0.3);
		color: var(--app-accent);
	}
</style>
