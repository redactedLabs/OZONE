<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchPoolAssets, getTokenLogoSync } from '$lib/utils/tokenLogos';

	let address = $state('');
	let phase = $state<'idle' | 'loading' | 'done'>('idle');
	let loadStep = $state(0);
	let report = $state<any>(null);
	let error = $state('');
	let copied = $state(false);
	let poolAssets = $state<string[]>([]);
	let heroVisible = $state(false);
	const heroWords = ['THORChain', 'Rujira'];
	let heroWordIndex = $state(0);

	// Share options
	let dateFrom = $state('');
	let dateTo = $state('');
	let includeNew = $state(false);
	let revealWallet = $state(false);
	let showShareOpts = $state(false);

	// Load pool assets on mount for dynamic logo resolution
	fetchPoolAssets().then((assets) => { poolAssets = assets; });

	onMount(() => {
		heroVisible = true;
		const interval = setInterval(() => {
			heroWordIndex = (heroWordIndex + 1) % heroWords.length;
		}, 3000);
		return () => clearInterval(interval);
	});

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
		// Rujira decoded types
		'fin-trade': 'Trade', 'fin-arb': 'Arb', 'fin-range': 'Range LP',
		'fin-range-fee': 'Range Fee', 'ghost-borrow': 'Borrow', 'ghost-repay': 'Repay',
		'ghost-lend': 'Lend', 'ghost-withdraw': 'Withdraw Lend',
		'bow-swap': 'AMM Swap', 'tc-swap': 'Swap (TC)',
		'calc-init': 'DCA Create', 'calc-process': 'DCA Execute',
		'calc-withdraw': 'DCA Withdraw', 'calc-create': 'DCA Strategy',
		'calc-internal': 'DCA (step)', 'calc-update': 'DCA Update',
		'fin-order': 'Limit Order', 'fin-order-wd': 'Cancel Order',
	};
	const typeColors: Record<string, string> = {
		swap: 'var(--app-accent)', addLiquidity: '#10b981', withdraw: '#f59e0b', send: '#22d3ee', refund: '#ef4444',
		switch: '#a78bfa', contract: '#64748b', donate: '#f472b6',
		// Rujira decoded types
		'fin-trade': '#f59e0b', 'fin-arb': '#f97316', 'fin-range': '#10b981',
		'fin-range-fee': '#10b981', 'ghost-borrow': '#ef4444', 'ghost-repay': '#22c55e',
		'ghost-lend': '#6366f1', 'ghost-withdraw': '#a78bfa',
		'bow-swap': '#6366f1', 'tc-swap': '#6366f1',
		'calc-init': '#a78bfa', 'calc-process': '#a78bfa',
		'calc-withdraw': '#a78bfa', 'calc-create': '#a78bfa',
		'calc-internal': '#94a3b8', 'calc-update': '#94a3b8',
		'fin-order': '#f59e0b', 'fin-order-wd': '#f59e0b',
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
			// Koinly labels for Rujira types
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
		activeFilter === '_rujira'
			? report?.transactions?.filter((t: any) => rujiraTypes.includes(t.type)) || []
			: activeFilter === '_ghost'
				? report?.transactions?.filter((t: any) => ghostTypes.includes(t.type)) || []
				: activeFilter === '_dca'
					? report?.transactions?.filter((t: any) => calcTypes.includes(t.type)) || []
					: activeFilter
						? report?.transactions?.filter((t: any) => t.type === activeFilter) || []
						: report?.transactions || []
	);

	const txSwaps = $derived(report?.transactions?.filter((t: any) => t.type === 'swap').length || 0);
	const txAdds = $derived(report?.transactions?.filter((t: any) => t.type === 'addLiquidity').length || 0);
	const txWithdraws = $derived(report?.transactions?.filter((t: any) => t.type === 'withdraw').length || 0);
	const txSends = $derived(report?.transactions?.filter((t: any) => t.type === 'send').length || 0);

	// Rujira-specific stats
	const rujiraTypes = ['fin-trade', 'fin-arb', 'fin-range', 'fin-range-fee', 'bow-swap', 'tc-swap'];
	const ghostTypes = ['ghost-borrow', 'ghost-repay', 'ghost-lend', 'ghost-withdraw'];
	const calcTypes = ['calc-init', 'calc-process', 'calc-withdraw', 'calc-create', 'calc-internal', 'calc-update'];

	const txRujiraTrades = $derived(report?.transactions?.filter((t: any) => rujiraTypes.includes(t.type)).length || 0);
	const txGhost = $derived(report?.transactions?.filter((t: any) => ghostTypes.includes(t.type)).length || 0);
	const txDCA = $derived(report?.transactions?.filter((t: any) => calcTypes.includes(t.type)).length || 0);

	// DCA step grouping — group calc-internal/calc-update under their parent DCA tx
	let expandedDCA = $state<Set<number>>(new Set());
	const dcaInternalTypes = ['calc-internal', 'calc-update'];
	const dcaParentTypes = ['calc-process', 'calc-create', 'calc-init', 'calc-withdraw'];

	function isDCAParent(type: string) { return dcaParentTypes.includes(type); }
	function isDCAChild(type: string) { return dcaInternalTypes.includes(type); }
	function toggleDCA(idx: number) {
		const next = new Set(expandedDCA);
		if (next.has(idx)) next.delete(idx); else next.add(idx);
		expandedDCA = next;
	}
	// Count child steps after a DCA parent
	function countDCAChildren(txs: any[], parentIdx: number): number {
		let count = 0;
		for (let i = parentIdx + 1; i < txs.length; i++) {
			if (isDCAChild(txs[i].type)) count++;
			else break;
		}
		return count;
	}
</script>

<svelte:head>
	<title>THORChain Wallet Explorer & History Export — Ozone</title>
	<meta name="description" content="Explore any THORChain wallet. Export history as Koinly CSV. Share privately with your tax advisor, lawyer, or anyone — no account needed. Free tool by Redacted." />
	<meta property="og:title" content="THORChain Wallet Explorer & History Export — Ozone" />
	<meta property="og:description" content="Explore THORChain wallets. Export history. Share privately with anyone." />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="mx-auto px-4 pt-20 pb-16" class:max-w-6xl={phase === 'idle'} class:max-w-5xl={phase !== 'idle'}>
	{#if phase === 'idle'}

		<!-- A. Hero Section -->
		<div class="hero-section text-center mb-16" class:hero-visible={heroVisible}>
			<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 hero-badge">
				<span class="relative flex h-2 w-2">
					<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style="background: #22d3ee;"></span>
					<span class="relative inline-flex rounded-full h-2 w-2" style="background: #22d3ee;"></span>
				</span>
				<span class="text-[10px] font-mono tracking-wider uppercase" style="color: var(--text-muted);">Exportable &middot; Shareable &middot; Private</span>
			</div>

			<h1 class="hero-title text-4xl sm:text-5xl font-bold tracking-tight mb-4">
				Explore your {#key heroWordIndex}<span class="hero-gradient hero-word">{heroWords[heroWordIndex]}</span>{/key} wallet history
			</h1>

			<p class="text-base sm:text-lg max-w-2xl mx-auto mb-2" style="color: var(--text-muted);">
				Full transaction history for any THORChain address. Export as CSV, share privately with your tax advisor, lawyer, or anyone.
			</p>
			<p class="text-sm max-w-xl mx-auto" style="color: var(--text-faint);">
				No account needed. Wallet address hidden by default. Powered by Midgard.
			</p>
		</div>

		<!-- Input card -->
		<div class="hist-card rounded-2xl p-6 sm:p-8 max-w-xl mx-auto mb-16" data-win-title="Wallet Explorer">
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
						<button onclick={() => includeNew = false} class="px-3 py-2 text-[11px] font-medium transition-all" style="{!includeNew ? 'background: var(--app-accent); color: white;' : 'color: var(--text-muted);'}">
							Snapshot
						</button>
						<button onclick={() => includeNew = true} class="px-3 py-2 text-[11px] font-medium transition-all" style="{includeNew ? 'background: var(--app-accent); color: white;' : 'color: var(--text-muted);'}">
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

		<!-- B. Value Proposition Cards -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
			<div class="hist-card rounded-xl p-5" data-win-title="CSV Export">
				<div class="flex items-center gap-2 mb-3">
					<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.2);">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
					</div>
					<h3 class="text-sm font-semibold" style="color: var(--text);">CSV Export</h3>
				</div>
				<p class="text-xs leading-relaxed mb-3" style="color: var(--text-muted);">
					One-click Koinly CSV with labeled swaps, LP events, fees, and ISO timestamps. Or export raw CSV for any spreadsheet or tax tool.
				</p>
				<div class="flex flex-wrap gap-1.5">
					<span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: rgba(34,211,238,0.08); color: #22d3ee; border: 1px solid rgba(34,211,238,0.15);">Koinly</span>
					<span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: rgba(34,211,238,0.08); color: #22d3ee; border: 1px solid rgba(34,211,238,0.15);">Raw CSV</span>
				</div>
			</div>

			<div class="hist-card rounded-xl p-5" data-win-title="Anonymous Sharing">
				<div class="flex items-center gap-2 mb-3">
					<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.2);">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
					</div>
					<h3 class="text-sm font-semibold" style="color: var(--text);">Anonymous Sharing</h3>
				</div>
				<p class="text-xs leading-relaxed mb-3" style="color: var(--text-muted);">
					Share reports with your tax advisor, lawyer, or anyone via a unique link. Wallet address hidden by default. No login required.
				</p>
				<div class="flex flex-wrap gap-1.5">
					<span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: rgba(168,85,247,0.08); color: #a855f7; border: 1px solid rgba(168,85,247,0.15);">Private links</span>
					<span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: rgba(168,85,247,0.08); color: #a855f7; border: 1px solid rgba(168,85,247,0.15);">No login</span>
				</div>
			</div>

			<div class="hist-card rounded-xl p-5" data-win-title="Tax Season Ready">
				<div class="flex items-center gap-2 mb-3">
					<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
					</div>
					<h3 class="text-sm font-semibold" style="color: var(--text);">Tax Season Ready</h3>
				</div>
				<p class="text-xs leading-relaxed mb-3" style="color: var(--text-muted);">
					Swaps, LP adds, withdrawals, and sends — all categorized and labeled. Filter by date range to match your tax year. Share the report with your accountant.
				</p>
				<div class="flex flex-wrap gap-1.5">
					<span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: rgba(16,185,129,0.08); color: #10b981; border: 1px solid rgba(16,185,129,0.15);">Date filtering</span>
					<span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: rgba(16,185,129,0.08); color: #10b981; border: 1px solid rgba(16,185,129,0.15);">Categorized</span>
				</div>
			</div>
		</div>

		<!-- C. Tax Export Showcase -->
		<div class="hist-card rounded-2xl p-6 sm:p-8 mb-16" data-win-title="Export Format">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
				<div>
					<div class="text-[10px] font-mono uppercase tracking-wider mb-2" style="color: #22d3ee;">Export Format</div>
					<h2 class="text-xl font-bold mb-4" style="color: var(--text);">CSV Export</h2>
					<div class="space-y-2.5 mb-5">
						{#each [
							'Swaps labeled with route details',
							'LP add/withdraw events separated',
							'Fee amounts in native currency',
							'ISO 8601 date format',
						] as item}
							<div class="flex items-center gap-2">
								<span class="shrink-0 text-xs leading-none" style="color: #10b981;">&#10003;</span>
								<span class="text-xs leading-none" style="color: var(--text-muted);">{item}</span>
							</div>
						{/each}
					</div>
					<div class="flex flex-wrap gap-2">
						<span class="text-[10px] font-medium px-2.5 py-1 rounded-lg" style="background: rgba(99,102,241,0.06); border: 1px solid var(--app-border-subtle); color: var(--text-muted);">Koinly</span>
						<span class="text-[10px] font-medium px-2.5 py-1 rounded-lg" style="background: rgba(99,102,241,0.06); border: 1px solid var(--app-border-subtle); color: var(--text-muted);">CoinTracker</span>
						<span class="text-[10px] font-medium px-2.5 py-1 rounded-lg" style="background: rgba(99,102,241,0.06); border: 1px solid var(--app-border-subtle); color: var(--text-muted);">CryptoTaxCalculator</span>
					</div>
				</div>
				<div class="rounded-xl overflow-hidden" style="background: rgba(15,23,42,0.5); border: 1px solid var(--app-border-subtle);">
					<div class="flex items-center gap-2 px-4 py-2.5" style="background: rgba(15,23,42,0.8); border-bottom: 1px solid var(--app-border-subtle);">
						<span class="w-2.5 h-2.5 rounded-full" style="background: #ef4444;"></span>
						<span class="w-2.5 h-2.5 rounded-full" style="background: #f59e0b;"></span>
						<span class="w-2.5 h-2.5 rounded-full" style="background: #10b981;"></span>
						<span class="text-[10px] font-mono ml-2" style="color: var(--text-faint);">koinly-export.csv</span>
					</div>
					<div class="p-4 font-mono text-[10px] leading-relaxed overflow-x-auto">
						<div style="color: var(--text-faint);">Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Label</div>
						<div><span style="color: #22d3ee;">2024-03-15T14:23:00Z</span>,<span style="color: #f59e0b;">1.5</span>,<span style="color: var(--text-muted);">ETH.ETH</span>,<span style="color: #10b981;">52847.32</span>,<span style="color: var(--text-muted);">THOR.RUNE</span>,</div>
						<div><span style="color: #22d3ee;">2024-03-14T09:11:00Z</span>,<span style="color: #f59e0b;">10000</span>,<span style="color: var(--text-muted);">THOR.RUNE</span>,,,<span style="color: #a855f7;">liquidity_in</span></div>
						<div><span style="color: #22d3ee;">2024-03-13T18:45:00Z</span>,,,<span style="color: #10b981;">0.8</span>,<span style="color: var(--text-muted);">BTC.BTC</span>,<span style="color: #a855f7;">liquidity_out</span></div>
						<div><span style="color: #22d3ee;">2024-03-12T22:07:00Z</span>,<span style="color: #f59e0b;">500</span>,<span style="color: var(--text-muted);">THOR.RUNE</span>,<span style="color: #10b981;">2.41</span>,<span style="color: var(--text-muted);">AVAX.AVAX</span>,</div>
					</div>
				</div>
			</div>
		</div>

		<!-- D. Audience Segments -->
		<div class="mb-16">
			<h2 class="text-lg font-bold mb-6 text-center" style="color: var(--text);">Who is this for?</h2>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="hist-card rounded-xl p-6" style="border-color: rgba(99,102,241,0.15);">
					<div class="flex items-center gap-2 mb-3">
						<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
						</div>
						<h3 class="text-sm font-semibold" style="color: var(--text);">For Everyone</h3>
					</div>
					<ul class="space-y-2">
						{#each [
							'Paste any thor1... address — no account needed',
							'Export CSV for tax tools or spreadsheets',
							'Share privately with tax advisor, lawyer, or anyone',
							'Address hidden by default for privacy',
						] as item}
							<li class="flex items-center gap-2 text-xs" style="color: var(--text-muted);">
								<span class="shrink-0 text-xs leading-none" style="color: #6366f1;">+</span>
								<span class="leading-none">{item}</span>
							</li>
						{/each}
					</ul>
				</div>
				<div class="hist-card rounded-xl p-6" style="border-color: rgba(168,85,247,0.15);">
					<div class="flex items-center gap-2 mb-3">
						<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.2);">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
						</div>
						<h3 class="text-sm font-semibold" style="color: var(--text);">For Redacted Members</h3>
					</div>
					<ul class="space-y-2">
						{#each [
							'Private accounts with full trade history',
							'Share reports with externals securely',
							'Compliance-ready transaction records',
							'Batch export coming soon',
						] as item}
							<li class="flex items-center gap-2 text-xs" style="color: var(--text-muted);">
								<span class="shrink-0 text-xs leading-none" style="color: #a855f7;">+</span>
								<span class="leading-none">{item}</span>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>

		<!-- E. How It Works -->
		<div class="mb-16">
			<h2 class="text-lg font-bold mb-6 text-center" style="color: var(--text);">How it works</h2>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div class="hist-card rounded-xl p-5">
					<div class="text-2xl font-bold font-mono mb-3" style="color: var(--app-accent); opacity: 0.5;">01</div>
					<div class="text-sm font-semibold mb-1" style="color: var(--text);">Enter Address</div>
					<p class="text-xs leading-relaxed" style="color: var(--text-muted);">Paste your <code class="text-[10px] px-1 py-0.5 rounded" style="background: var(--bg-code);">thor1...</code> address. We query Midgard directly — no data is stored on our servers.</p>
				</div>
				<div class="hist-card rounded-xl p-5">
					<div class="text-2xl font-bold font-mono mb-3" style="color: var(--app-accent); opacity: 0.5;">02</div>
					<div class="text-sm font-semibold mb-1" style="color: var(--text);">Review History</div>
					<p class="text-xs leading-relaxed" style="color: var(--text-muted);">See all swaps, LP events, withdrawals, and sends. Filter by date range and transaction type.</p>
				</div>
				<div class="hist-card rounded-xl p-5">
					<div class="text-2xl font-bold font-mono mb-3" style="color: var(--app-accent); opacity: 0.5;">03</div>
					<div class="text-sm font-semibold mb-1" style="color: var(--text);">Export or Share</div>
					<p class="text-xs leading-relaxed" style="color: var(--text-muted);">Download CSV for tax tools, or share via private link with your advisor, lawyer, or team. Choose public or private mode.</p>
				</div>
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

		<!-- Rujira stats row (only shows if there are Rujira interactions) -->
		{#if txRujiraTrades > 0 || txGhost > 0 || txDCA > 0}
			<div class="flex flex-wrap gap-3 mb-4">
				{#if txRujiraTrades > 0}
					<button onclick={() => { activeFilter = activeFilter === '_rujira' ? null : '_rujira'; }} class="hist-card rounded-xl px-4 py-3 text-left transition-all flex items-center gap-3" style="{activeFilter === '_rujira' ? 'border-color: #f59e0b; box-shadow: 0 0 12px rgba(245,158,11,0.15);' : ''} cursor: pointer;">
						<div class="text-lg font-bold font-mono" style="color: #f59e0b;">{txRujiraTrades}</div>
						<div class="text-[10px]" style="color: var(--text-muted);">Rujira Trades</div>
					</button>
				{/if}
				{#if txGhost > 0}
					<button onclick={() => { activeFilter = activeFilter === '_ghost' ? null : '_ghost'; }} class="hist-card rounded-xl px-4 py-3 text-left transition-all flex items-center gap-3" style="{activeFilter === '_ghost' ? 'border-color: #ef4444; box-shadow: 0 0 12px rgba(239,68,68,0.15);' : ''} cursor: pointer;">
						<div class="text-lg font-bold font-mono" style="color: #ef4444;">{txGhost}</div>
						<div class="text-[10px]" style="color: var(--text-muted);">Lend/Borrow</div>
					</button>
				{/if}
				{#if txDCA > 0}
					<button onclick={() => { activeFilter = activeFilter === '_dca' ? null : '_dca'; }} class="hist-card rounded-xl px-4 py-3 text-left transition-all flex items-center gap-3" style="{activeFilter === '_dca' ? 'border-color: #a78bfa; box-shadow: 0 0 12px rgba(167,139,250,0.15);' : ''} cursor: pointer;">
						<div class="text-lg font-bold font-mono" style="color: #a78bfa;">{txDCA}</div>
						<div class="text-[10px]" style="color: var(--text-muted);">DCA Orders</div>
					</button>
				{/if}
			</div>
		{/if}

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
					{#each filteredTxs as tx, i}
						{@const childCount = isDCAParent(tx.type) ? countDCAChildren(filteredTxs, i) : 0}
						{@const isChild = isDCAChild(tx.type)}
						{@const parentIdx = (() => { if (!isChild) return -1; for (let j = i - 1; j >= 0; j--) { if (isDCAParent(filteredTxs[j].type)) return j; if (!isDCAChild(filteredTxs[j].type)) break; } return -1; })()}
						{@const hidden = isChild && parentIdx >= 0 && !expandedDCA.has(parentIdx)}
						{#if !hidden}
						<tr style="border-bottom: 1px solid var(--app-border-subtle);{isChild ? ' opacity: 0.7;' : ''}">
							<td class="px-4 py-2.5 text-xs" style="color: var(--text-muted);">
								{#if isChild}<span class="pl-3" style="color: var(--text-ghost);">&#8627;</span>{/if}
								{tx.date ? new Date(tx.date).toLocaleDateString() : '--'}
							</td>
							<td class="px-4 py-2.5">
								<span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background: {typeColors[tx.type] || 'var(--text-ghost)'}15; color: {typeColors[tx.type] || 'var(--text-ghost)'};">
									{typeLabels[tx.type] || tx.type}
								</span>
								{#if childCount > 0}
									<button onclick={() => toggleDCA(i)} class="text-[9px] ml-1 px-1.5 py-0.5 rounded" style="background: rgba(167,139,250,0.1); color: #a78bfa; border: 1px solid rgba(167,139,250,0.2);">
										{expandedDCA.has(i) ? 'hide' : `+${childCount} steps`}
									</button>
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
							<td class="px-4 py-2.5">
								{#if tx.txID}
									<a href="https://runescan.io/tx/{tx.txID}" target="_blank" rel="noopener" class="text-[10px] transition-colors" style="color: var(--text-ghost);" title="View on RuneScan">&#8599;</a>
								{/if}
							</td>
						</tr>
						{/if}
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

	/* Hero animations */
	.hero-section {
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.6s ease, transform 0.6s ease;
	}
	.hero-section.hero-visible {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-title {
		color: var(--text);
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.6s ease 0.1s, transform 0.6s ease 0.1s;
	}
	.hero-visible .hero-title {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-badge {
		background: rgba(34,211,238,0.08);
		border: 1px solid rgba(34,211,238,0.15);
		opacity: 0;
		transform: translateY(8px);
		transition: opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s;
	}
	.hero-visible .hero-badge {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-gradient {
		background: linear-gradient(135deg, #22d3ee, #6366f1, #a78bfa);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.hero-word {
		display: inline-block;
		animation: heroFade 0.4s ease;
	}
	@keyframes heroFade {
		0% { opacity: 0; transform: translateY(4px); }
		100% { opacity: 1; transform: translateY(0); }
	}

	@keyframes ping {
		75%, 100% {
			transform: scale(2);
			opacity: 0;
		}
	}
	.animate-ping {
		animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
</style>
