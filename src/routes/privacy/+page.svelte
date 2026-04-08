<script lang="ts">
	import { getTokenLogoSync } from '$lib/utils/tokenLogos';

	let { data } = $props();

	let copied = $state('');

	function fmt(n: number, decimals = 2): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}k`;
		return n.toFixed(decimals);
	}

	function fmtUsd(n: number): string {
		if (n === 0) return '$0';
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
		return `$${n.toFixed(2)}`;
	}

	function truncAddr(addr: string): string {
		if (addr.length <= 16) return addr;
		return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => (copied = ''), 2000);
		} catch { /* noop */ }
	}

	function timeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}
</script>

<svelte:head>
	<title>Redacted Private Wallets — Privacy Dashboard | Ozone</title>
	<meta name="description" content="Track the Redacted Private Wallet protocol — TVL, Private Reserve balance, sub-wallet count, and protocol fee. Privacy-preserving wallets on THORChain." />
	<meta property="og:title" content="Redacted Private Wallets — Privacy Dashboard" />
	<meta property="og:description" content="Privacy-preserving wallets on THORChain. Track TVL, Private Reserve, and protocol stats." />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-24 pb-16 sm:px-6">

	<!-- Header -->
	<div class="text-center mb-8">
		<h1 class="text-3xl sm:text-4xl font-bold tracking-tight mb-2" style="color: var(--text);">Redacted Dashboard</h1>
		<p class="text-sm" style="color: var(--text-muted);">
			Privacy-preserving wallets on Rujira & THORChain — deposit, interact, transact, withdraw without revealing your identity.
		</p>
	</div>

	<!-- Stats Cards -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
		<div class="dash-box stat-hover rounded-xl p-4 relative group" data-win-title="TVL">
			<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #10b981;">
				{data.totalTVLUsd > 0 ? fmtUsd(data.totalTVLUsd) : '$0'}
			</div>
			{#if data.tvlAssets.length > 0}
				<div class="flex items-center mt-1">
					{#each data.tvlAssets as asset}
						{@const logo = getTokenLogoSync(asset.asset)}
						{#if logo}
							<img src={logo} alt={asset.asset} class="w-4 h-4 rounded-full" style="margin-right: -4px; border: 1px solid var(--card-bg);" />
						{/if}
					{/each}
				</div>
			{/if}
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Total Value Locked</div>
			<div class="stat-tip" style="min-width: 200px;">
				<div class="text-[9px] font-semibold mb-1.5" style="color: var(--text-muted);">TVL Breakdown</div>
				{#each data.tvlAssets as asset}
					<div class="flex justify-between gap-4 py-0.5">
						<span class="font-mono">{asset.asset}</span>
						<span>
							{fmt(asset.amount)}
							{#if asset.usd > 0}
								<span style="color: var(--text-faint);">({fmtUsd(asset.usd)})</span>
							{/if}
						</span>
					</div>
				{/each}
				<div class="border-t mt-1.5 pt-1.5" style="border-color: var(--app-border);">
					<div class="flex justify-between font-semibold">
						<span>Total</span>
						<span>{fmtUsd(data.totalTVLUsd)}</span>
					</div>
				</div>
			</div>
		</div>

		<div class="dash-box stat-hover rounded-xl p-4 relative group" data-win-title="Wallets">
			<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #a78bfa;">
				{data.subWalletCount.toLocaleString('en-US')}
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Private Wallets</div>
			<div class="stat-tip">Number of sub-wallet contracts (code_id {data.codeIdSub}) instantiated from the proxy. Each user creates one Private Wallet via ZK proof.</div>
		</div>

		<div class="dash-box stat-hover rounded-xl p-4 relative group" data-win-title="Revenue">
			<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #22d3ee;">
				{fmtUsd(data.feeBalanceUsd)}
			</div>
			{#if data.feeAssets.length > 0}
				<div class="flex items-center gap-[-4px] mt-1">
					{#each data.feeAssets as asset}
						{@const logo = getTokenLogoSync(asset.asset)}
						{#if logo}
							<img src={logo} alt={asset.asset} class="w-4 h-4 rounded-full" style="margin-right: -4px; border: 1px solid var(--card-bg);" />
						{/if}
					{/each}
				</div>
			{/if}
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Total Fees</div>
			<div class="stat-tip" style="min-width: 200px;">
				<div class="text-[9px] font-semibold mb-1.5" style="color: var(--text-muted);">Fee Breakdown</div>
				{#each data.feeAssets as asset}
					<div class="flex justify-between gap-4 py-0.5">
						<span class="font-mono">{asset.asset}</span>
						<span>
							{fmt(asset.amount)}
							{#if asset.usd > 0}
								<span style="color: var(--text-faint);">({fmtUsd(asset.usd)})</span>
							{/if}
						</span>
					</div>
				{/each}
				<div class="border-t mt-1.5 pt-1.5" style="border-color: var(--app-border);">
					<div class="flex justify-between font-semibold">
						<span>Total</span>
						<span>{fmtUsd(data.feeBalanceUsd)}</span>
					</div>
				</div>
			</div>
		</div>

		<div class="dash-box stat-hover rounded-xl p-4 relative group" data-win-title="Fee">
			<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #f59e0b;">
				{data.config.fee}<span class="text-sm font-normal" style="color: #f59e0b;"> bps</span>
			</div>
			<div class="text-[10px] font-mono mt-0.5" style="color: var(--text-faint);">{(data.config.fee / 100).toFixed(2)}%</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Protocol Fee</div>
			<div class="stat-tip">Fee charged per interaction with the protocol. Read from the proxy contract state. Currently {data.config.fee} basis points ({(data.config.fee / 100).toFixed(2)}%).</div>
		</div>
	</div>

	<!-- Architecture Flow Diagram -->
	<div class="dash-box rounded-xl p-5 sm:p-6 pb-6 mb-6" data-win-title="Architecture">
		<h2 class="text-sm font-bold mb-4" style="color: var(--text);">How Private Wallets Work</h2>

		<!-- Desktop: horizontal flow -->
		<div class="hidden sm:flex items-center justify-center gap-0 mb-4">
			<!-- Public Wallet -->
			<div class="flow-box rounded-lg p-3 text-center" style="border: 2px solid #10b981; background: rgba(16,185,129,0.05); min-width: 120px;">
				<div class="text-xs font-bold mb-1" style="color: #10b981;">Public Wallet</div>
				<div class="text-[9px]" style="color: var(--text-faint);">Your thor1... address</div>
			</div>

			<!-- Arrow 1 -->
			<div class="flex flex-col items-center px-2">
				<div class="text-[8px] font-mono mb-1 px-2 py-0.5 rounded" style="background: rgba(16,185,129,0.1); color: #10b981;">AML Screen</div>
				<div class="text-sm font-mono" style="color: var(--text-faint);">&#8644;</div>
			</div>

			<!-- Private Reserve -->
			<div class="flow-box rounded-lg p-3 text-center" style="border: 2px solid #22d3ee; background: rgba(34,211,238,0.05); min-width: 120px;">
				<div class="text-xs font-bold mb-1" style="color: #22d3ee;">Private Reserve</div>
				<div class="text-[9px]" style="color: var(--text-faint);">Proxy contract</div>
			</div>

			<!-- Arrow 2 -->
			<div class="flex flex-col items-center px-2">
				<div class="text-[8px] font-mono mb-1 px-2 py-0.5 rounded" style="background: rgba(167,139,250,0.1); color: #a78bfa;">ZK Proof</div>
				<div class="text-sm font-mono" style="color: var(--text-faint);">&#8644;</div>
			</div>

			<!-- Private Wallet -->
			<div class="flow-box rounded-lg p-3 text-center" style="border: 2px solid #a78bfa; background: rgba(167,139,250,0.05); min-width: 120px;">
				<div class="text-xs font-bold mb-1" style="color: #a78bfa;">Spendable</div>
				<div class="text-[9px]" style="color: var(--text-faint);">Sub-wallet contract</div>
			</div>

			<!-- Arrow 3 -->
			<div class="flex flex-col items-center px-2">
				<div class="text-sm font-mono" style="color: var(--text-faint);">&#8644;</div>
			</div>

			<!-- DeFi -->
			<div class="flow-box rounded-lg p-3 text-center" style="border: 2px solid #f59e0b; background: rgba(245,158,11,0.05); min-width: 120px;">
				<div class="text-xs font-bold mb-1" style="color: #f59e0b;">DeFi</div>
				<div class="text-[9px]" style="color: var(--text-faint);">FIN, Ghost, BOW</div>
			</div>
		</div>

		<!-- Mobile: vertical flow -->
		<div class="flex sm:hidden flex-col items-center gap-0 mb-4">
			<div class="flow-box rounded-lg p-3 text-center w-full" style="border: 2px solid #10b981; background: rgba(16,185,129,0.05);">
				<div class="text-xs font-bold mb-1" style="color: #10b981;">Public Wallet</div>
				<div class="text-[9px]" style="color: var(--text-faint);">Your thor1... address</div>
			</div>

			<div class="flex flex-col items-center py-1">
				<div class="text-[8px] font-mono px-2 py-0.5 rounded" style="background: rgba(16,185,129,0.1); color: #10b981;">AML Screen</div>
				<div class="text-sm font-mono" style="color: var(--text-faint);">&#8645;</div>
			</div>

			<div class="flow-box rounded-lg p-3 text-center w-full" style="border: 2px solid #22d3ee; background: rgba(34,211,238,0.05);">
				<div class="text-xs font-bold mb-1" style="color: #22d3ee;">Private Reserve</div>
				<div class="text-[9px]" style="color: var(--text-faint);">Proxy contract</div>
			</div>

			<div class="flex flex-col items-center py-1">
				<div class="text-[8px] font-mono px-2 py-0.5 rounded" style="background: rgba(167,139,250,0.1); color: #a78bfa;">ZK Proof</div>
				<div class="text-sm font-mono" style="color: var(--text-faint);">&#8645;</div>
			</div>

			<div class="flow-box rounded-lg p-3 text-center w-full" style="border: 2px solid #a78bfa; background: rgba(167,139,250,0.05);">
				<div class="text-xs font-bold mb-1" style="color: #a78bfa;">Spendable</div>
				<div class="text-[9px]" style="color: var(--text-faint);">Sub-wallet contract</div>
			</div>

			<div class="flex flex-col items-center py-1">
				<div class="text-sm font-mono" style="color: var(--text-faint);">&#8645;</div>
			</div>

			<div class="flow-box rounded-lg p-3 text-center w-full" style="border: 2px solid #f59e0b; background: rgba(245,158,11,0.05);">
				<div class="text-xs font-bold mb-1" style="color: #f59e0b;">DeFi</div>
				<div class="text-[9px]" style="color: var(--text-faint);">FIN, Ghost, BOW</div>
			</div>
		</div>
	</div>

	<!-- Explainer Cards -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
		<div class="dash-box rounded-xl p-5" data-win-title="1. Deposit">
			<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
				<span class="step-dot" style="background: #10b981;"></span>
				<span class="text-[10px] font-mono" style="color: #10b981;">Step 1</span>
			</div>
			<h3 class="text-sm font-bold mb-1.5" style="color: var(--text);">Deposit</h3>
			<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
				Deposit RUNE from your public wallet into the Private Reserve. Your address is screened against AML and sanctions lists before the deposit is accepted.
			</p>
		</div>

		<div class="dash-box rounded-xl p-5" data-win-title="2. Create Wallet">
			<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2);">
				<span class="step-dot" style="background: #a78bfa;"></span>
				<span class="text-[10px] font-mono" style="color: #a78bfa;">Step 2</span>
			</div>
			<h3 class="text-sm font-bold mb-1.5" style="color: var(--text);">Create Private Wallet</h3>
			<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
				Generate a ZK proof to create a Private Wallet. Your identity is now hidden from this point forward. The link between your public address and private wallet is broken.
			</p>
		</div>

		<div class="dash-box rounded-xl p-5" data-win-title="3. Use DeFi">
			<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2);">
				<span class="step-dot" style="background: #f59e0b;"></span>
				<span class="text-[10px] font-mono" style="color: #f59e0b;">Step 3</span>
			</div>
			<h3 class="text-sm font-bold mb-1.5" style="color: var(--text);">Use in DeFi</h3>
			<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
				Your Private Wallet can trade on FIN, borrow on Ghost, LP on BOW, and more. Transaction amounts are visible on-chain, but your identity is not.
			</p>
		</div>

		<div class="dash-box rounded-xl p-5" data-win-title="4. Withdraw">
			<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.2);">
				<span class="step-dot" style="background: #22d3ee;"></span>
				<span class="text-[10px] font-mono" style="color: #22d3ee;">Step 4</span>
			</div>
			<h3 class="text-sm font-bold mb-1.5" style="color: var(--text);">Withdraw</h3>
			<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
				Move funds back to Private Reserve, then withdraw to your original public address. ZK proof required. Same address in, same address out.
			</p>
		</div>
	</div>

	<!-- Contract Details -->
	<div class="dash-box rounded-xl p-5" data-win-title="Contract Details">
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div>
				<div class="text-[10px] mb-1" style="color: var(--text-faint);">Proxy Contract (Private Reserve)</div>
				<button
					class="text-xs font-mono cursor-pointer bg-transparent border-none p-0"
					style="color: var(--text);"
					title="Click to copy"
					onclick={() => copyToClipboard(data.proxyAddress)}
				>
					{truncAddr(data.proxyAddress)}
					<span class="text-[9px] ml-1" style="color: var(--text-faint);">{copied === data.proxyAddress ? 'Copied!' : '(click to copy)'}</span>
				</button>
			</div>

			<div>
				<div class="text-[10px] mb-1" style="color: var(--text-faint);">Code IDs</div>
				<div class="text-xs font-mono" style="color: var(--text);">
					<span style="color: #22d3ee;">Proxy: {data.codeIdProxy}</span>
					<span class="mx-2" style="color: var(--text-ghost);">|</span>
					<span style="color: #a78bfa;">Sub-wallet: {data.codeIdSub}</span>
				</div>
			</div>

			<div>
				<div class="text-[10px] mb-1" style="color: var(--text-faint);">Last Fetched</div>
				<div class="text-xs font-mono" style="color: var(--text);">{timeAgo(data.fetchedAt)}</div>
			</div>

			{#if data.runePriceUsd > 0}
				<div>
					<div class="text-[10px] mb-1" style="color: var(--text-faint);">RUNE Price</div>
					<div class="text-xs font-mono" style="color: var(--text);">${data.runePriceUsd.toFixed(2)}</div>
				</div>
			{/if}
		</div>

		<div class="mt-4 pt-3" style="border-top: 1px solid var(--app-border-subtle);">
			<a href="https://docs.redacted.money/protocol/architecture" target="_blank" rel="noopener" class="text-xs font-medium" style="color: var(--app-accent); text-decoration: none;">
				Read full architecture docs &#8599;
			</a>
		</div>
	</div>

</div>

<style>
	.dash-box {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
	}
	.stat-tip {
		display: none;
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		right: 0;
		z-index: 30;
		padding: 8px 10px;
		border-radius: 12px;
		font-size: 10px;
		line-height: 1.5;
		color: var(--text-secondary);
		background: var(--tooltip-bg);
		border: 1px solid var(--tooltip-border);
		box-shadow: 0 8px 24px rgba(0,0,0,0.3);
		pointer-events: none;
	}
	.stat-hover:hover .stat-tip { display: block; }
	.stat-hover:hover { z-index: 30; }

	.flow-box {
		transition: border-color 0.2s;
	}
	.step-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
