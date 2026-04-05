<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	let autoRefresh = $state(true);
	let refreshInterval: ReturnType<typeof setInterval>;

	const typeColors: Record<string, string> = {
		SWAP: 'background: rgba(59,130,246,0.15); color: #3b82f6',
		ADD: 'background: rgba(16,185,129,0.15); color: #10b981',
		WITHDRAW: 'background: rgba(245,158,11,0.15); color: #f59e0b',
		RUJIRA: 'background: rgba(168,85,247,0.15); color: #a855f7',
		OTHER: 'background: rgba(100,116,139,0.15); color: #94a3b8',
		DONATE: 'background: rgba(236,72,153,0.15); color: #ec4899',
		BOND: 'background: rgba(34,211,238,0.15); color: #22d3ee',
	};

	function truncate(s: string | null, len = 16): string {
		if (!s) return '—';
		return s.length > len ? s.slice(0, len) + '...' : s;
	}

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return '—';
		const diff = Date.now() - new Date(dateStr).getTime();
		const secs = Math.floor(diff / 1000);
		if (secs < 5) return 'just now';
		if (secs < 60) return `${secs}s ago`;
		const mins = Math.floor(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		return `${Math.floor(mins / 60)}h ago`;
	}

	onMount(() => {
		refreshInterval = setInterval(() => {
			if (autoRefresh) invalidateAll();
		}, 5000); // Refresh every 5s

		return () => clearInterval(refreshInterval);
	});
</script>

<svelte:head>
	<title>Live Logs — Admin</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="flex items-end justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold" style="color: #f1f5f9;">Live Logs</h1>
			<p class="text-sm mt-1" style="color: #64748b;">
				{data.stats.totalTxs.toLocaleString()} transactions indexed · {data.stats.totalUsers.toLocaleString()} users · {data.stats.newUsersLast7d} new (7d)
			</p>
		</div>
		<div class="flex items-center gap-3">
			<label class="flex items-center gap-2 text-sm cursor-pointer" style="color: #64748b;">
				<input type="checkbox" bind:checked={autoRefresh} class="rounded" />
				Auto-refresh (5s)
			</label>
			{#if autoRefresh}
				<span class="inline-block h-2 w-2 rounded-full animate-pulse" style="background: #10b981;"></span>
			{/if}
		</div>
	</div>

	<!-- TX Type Stats -->
	<div class="mb-6 flex flex-wrap gap-2">
		{#each data.stats.txByType as stat}
			<div class="rounded-lg px-3 py-2 text-sm" style="background: #0d0d1f; border: 1px solid #1e293b;">
				<span class="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold mr-1" style={typeColors[stat.type] || typeColors.OTHER}>{stat.type}</span>
				<span style="color: #f1f5f9;">{stat.count.toLocaleString()}</span>
			</div>
		{/each}
	</div>

	<div class="grid gap-6 lg:grid-cols-3">
		<!-- Live TX Feed (2/3 width) -->
		<div class="lg:col-span-2 rounded-xl overflow-hidden" style="background: #0d0d1f; border: 1px solid #1e293b;">
			<div class="px-4 py-3 flex items-center justify-between" style="border-bottom: 1px solid #1e293b;">
				<h2 class="text-sm font-semibold" style="color: #f1f5f9;">WebSocket TX Feed</h2>
				<span class="text-xs" style="color: #64748b;">Last 50 transactions</span>
			</div>
			<div class="max-h-[600px] overflow-y-auto">
				{#each data.transactions as tx}
					<div class="px-4 py-2 flex items-center gap-3 text-xs" style="border-bottom: 1px solid var(--app-border-subtle);">
						<span class="shrink-0 rounded px-1.5 py-0.5 font-semibold" style={typeColors[tx.memoType || 'OTHER'] || typeColors.OTHER}>
							{tx.memoType || '?'}
						</span>
						<span class="font-mono shrink-0" style="color: #818cf8;" title={tx.fromAddress || ''}>
							{truncate(tx.fromAddress, 12)}
						</span>
						<span style="color: #334155;">→</span>
						<span class="font-mono shrink-0" style="color: #10b981;" title={tx.toAddress || ''}>
							{truncate(tx.toAddress, 12)}
						</span>
						{#if tx.asset}
							<span class="shrink-0" style="color: #64748b;">{tx.asset}</span>
						{/if}
						<span class="ml-auto shrink-0" style="color: #475569;">
							{timeAgo(tx.timestamp)}
						</span>
					</div>
				{/each}
				{#if data.transactions.length === 0}
					<div class="px-4 py-12 text-center" style="color: #64748b;">
						No transactions yet. Worker might still be connecting...
					</div>
				{/if}
			</div>
		</div>

		<!-- Sync Logs (1/3 width) -->
		<div class="rounded-xl overflow-hidden" style="background: #0d0d1f; border: 1px solid #1e293b;">
			<div class="px-4 py-3" style="border-bottom: 1px solid #1e293b;">
				<h2 class="text-sm font-semibold" style="color: #f1f5f9;">Sync History</h2>
			</div>
			<div class="max-h-[600px] overflow-y-auto">
				{#each data.syncLogs as sync}
					<div class="px-4 py-2 text-xs" style="border-bottom: 1px solid var(--app-border-subtle);">
						<div class="flex items-center gap-2">
							{#if sync.status === 'success'}
								<span style="color: #10b981;">✓</span>
							{:else}
								<span style="color: #ef4444;">✗</span>
							{/if}
							<span class="font-mono font-medium" style="color: #f1f5f9;">{sync.type}</span>
							<span class="ml-auto" style="color: #475569;">{timeAgo(sync.createdAt)}</span>
						</div>
						<div class="mt-1 flex gap-3" style="color: #64748b;">
							<span>{sync.recordsProcessed?.toLocaleString() || 0} records</span>
							{#if sync.flagsFound}
								<span style="color: #ef4444;">{sync.flagsFound} flags</span>
							{/if}
							{#if sync.duration}
								<span>{(sync.duration / 1000).toFixed(1)}s</span>
							{/if}
						</div>
						{#if sync.error}
							<div class="mt-1 truncate" style="color: #ef4444;">{sync.error}</div>
						{/if}
					</div>
				{/each}
				{#if data.syncLogs.length === 0}
					<div class="px-4 py-12 text-center" style="color: #64748b;">No sync logs yet.</div>
				{/if}
			</div>
		</div>
	</div>
</div>
