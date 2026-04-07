<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	let autoRefresh = $state(true);
	let refreshInterval: ReturnType<typeof setInterval>;
	let loadingType = $state<string | null>(null);
	let lastResult = $state<{ type: string; success: boolean; message: string } | null>(null);

	function timeAgo(dateStr: string | null | undefined): string {
		if (!dateStr) return 'Never';
		const diff = Date.now() - new Date(dateStr).getTime();
		const secs = Math.floor(diff / 1000);
		if (secs < 5) return 'just now';
		if (secs < 60) return `${secs}s ago`;
		const mins = Math.floor(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function formatDuration(ms: number | null): string {
		if (ms == null) return '—';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	const syncTypeMap: Record<string, { name: string; triggerType: string; color: string }> = {
		MIDGARD: { name: 'Members', triggerType: 'members', color: '#818cf8' },
		OFAC: { name: 'OFAC SDN', triggerType: 'ofac', color: '#ef4444' },
		EU: { name: 'EU Sanctions', triggerType: 'eu', color: '#3b82f6' },
		HACK: { name: 'Known Hacks', triggerType: 'hacks', color: '#f59e0b' },
		TETHER: { name: 'Tether Frozen', triggerType: 'tether', color: '#26a17b' },
		SCREEN: { name: 'Screening', triggerType: 'screening', color: '#6366f1' },
		L1_DISCOVERY: { name: 'L1 Discovery', triggerType: 'l1-batch', color: '#10b981' },
	};

	async function triggerSync(type: string) {
		loadingType = type;
		lastResult = null;
		try {
			const res = await fetch('/api/admin/sync-trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type })
			});
			const result = await res.json();
			if (result.error) {
				lastResult = { type, success: false, message: result.error };
			} else {
				lastResult = { type, success: true, message: JSON.stringify(result.result) };
				await invalidateAll();
			}
		} catch (e: any) {
			lastResult = { type, success: false, message: e?.message || 'Failed' };
		} finally {
			loadingType = null;
		}
	}

	async function triggerRefetchAll() {
		if (!confirm('This will mark ALL users for L1 re-fetch. The cron will process them in batches of 30. Continue?')) return;
		await triggerSync('l1-refetch');
	}

	const progressPct = $derived(
		data.stats.thorUsers > 0
			? Math.round((data.stats.fetchedUsers / data.stats.thorUsers) * 100)
			: 0
	);

	onMount(() => {
		refreshInterval = setInterval(() => {
			if (autoRefresh) invalidateAll();
		}, 5000);
		return () => clearInterval(refreshInterval);
	});
</script>

<svelte:head>
	<title>Sync Dashboard — Admin</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="flex items-end justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold" style="color: #f1f5f9;">Sync Dashboard</h1>
			<p class="text-sm mt-1" style="color: #64748b;">Monitor sync status, trigger re-syncs, track L1 discovery progress</p>
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

	{#if lastResult}
		<div class="mb-4 rounded-lg px-4 py-3 text-sm" style="background: {lastResult.success ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid {lastResult.success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; color: {lastResult.success ? '#10b981' : '#ef4444'};">
			<strong>{lastResult.type}:</strong> {lastResult.message}
		</div>
	{/if}

	<!-- Summary Cards -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
		<div class="rounded-xl p-4" style="background: #0d0d1f; border: 1px solid #1e293b;">
			<div class="text-xs font-medium mb-1" style="color: #64748b;">Thor Users</div>
			<div class="text-2xl font-bold" style="color: #f1f5f9;">{data.stats.thorUsers.toLocaleString()}</div>
		</div>
		<div class="rounded-xl p-4 group relative" style="background: #0d0d1f; border: 1px solid #1e293b;">
			<div class="text-xs font-medium mb-1" style="color: #64748b;">L1 Addresses</div>
			<div class="text-2xl font-bold" style="color: #f1f5f9;">{data.stats.l1Total.toLocaleString()}</div>
			{#if data.stats.l1ByChain.length > 0}
				<div class="hidden group-hover:block absolute top-full left-0 mt-1 z-10 rounded-lg p-3 text-xs" style="background: #0d0d1f; border: 1px solid #1e293b; min-width: 160px;">
					{#each data.stats.l1ByChain as chain}
						<div class="flex justify-between py-0.5" style="color: #94a3b8;">
							<span>{chain.chain}</span>
							<span style="color: #f1f5f9;">{chain.count.toLocaleString()}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<div class="rounded-xl p-4 group relative" style="background: #0d0d1f; border: 1px solid #1e293b;">
			<div class="text-xs font-medium mb-1" style="color: #64748b;">Compliance Entries</div>
			<div class="text-2xl font-bold" style="color: #f1f5f9;">{data.stats.complianceTotal.toLocaleString()}</div>
			{#if data.stats.complianceBySource.length > 0}
				<div class="hidden group-hover:block absolute top-full left-0 mt-1 z-10 rounded-lg p-3 text-xs" style="background: #0d0d1f; border: 1px solid #1e293b; min-width: 160px;">
					{#each data.stats.complianceBySource as src}
						<div class="flex justify-between py-0.5" style="color: #94a3b8;">
							<span>{src.source}</span>
							<span style="color: #f1f5f9;">{src.count.toLocaleString()}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<div class="rounded-xl p-4" style="background: #0d0d1f; border: 1px solid #1e293b;">
			<div class="text-xs font-medium mb-1" style="color: #64748b;">Flagged Users</div>
			<div class="text-2xl font-bold" style="color: {data.stats.flaggedUsers > 0 ? '#ef4444' : '#10b981'};">{data.stats.flaggedUsers.toLocaleString()}</div>
		</div>
	</div>

	<!-- L1 Discovery Progress -->
	<div class="rounded-xl p-6 mb-6" style="background: #0d0d1f; border: 1px solid #1e293b;">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-lg font-semibold" style="color: #f1f5f9;">L1 Discovery Progress</h2>
			<div class="flex gap-2">
				<button
					onclick={() => triggerSync('l1-batch')}
					disabled={loadingType !== null}
					class="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
					style="background: #10b981;"
				>
					{loadingType === 'l1-batch' ? 'Processing...' : 'Fetch Next Batch'}
				</button>
				<button
					onclick={triggerRefetchAll}
					disabled={loadingType !== null}
					class="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
					style="background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);"
				>
					{loadingType === 'l1-refetch' ? 'Resetting...' : 'Re-fetch ALL'}
				</button>
			</div>
		</div>

		<div class="mb-3">
			<div class="flex justify-between text-xs mb-1" style="color: #94a3b8;">
				<span>{data.stats.fetchedUsers.toLocaleString()} / {data.stats.thorUsers.toLocaleString()} users fetched</span>
				<span>{progressPct}%</span>
			</div>
			<div class="w-full rounded-full h-2.5" style="background: #1e293b;">
				<div class="h-2.5 rounded-full transition-all duration-500" style="width: {progressPct}%; background: #10b981;"></div>
			</div>
			{#if data.stats.unfetchedUsers > 0}
				<p class="text-[10px] mt-1" style="color: #475569;">
					{data.stats.unfetchedUsers.toLocaleString()} remaining · ~{Math.ceil(data.stats.unfetchedUsers / 30)} batches · ETA ~{Math.ceil(data.stats.unfetchedUsers / 1440)} days at 2 cron runs/hour
				</p>
			{/if}
		</div>

		{#if data.stats.l1ByChain.length > 0}
			<div class="flex flex-wrap gap-2 mt-3">
				{#each data.stats.l1ByChain as chain}
					<div class="rounded-lg px-2.5 py-1 text-xs" style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2);">
						<span class="font-medium" style="color: #10b981;">{chain.chain}</span>
						<span style="color: #94a3b8;">{chain.count.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Sync Status Cards -->
	<div class="mb-6">
		<h2 class="text-lg font-semibold mb-4" style="color: #f1f5f9;">Sync Status</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
			{#each Object.entries(syncTypeMap) as [key, info]}
				{@const syncData = data.syncTypes.find(s => s.type === key)}
				<div class="rounded-xl p-4" style="background: #0d0d1f; border: 1px solid #1e293b;">
					<div class="flex items-center gap-2 mb-3">
						<span class="rounded px-2 py-0.5 text-[10px] font-bold" style="background: {info.color}22; color: {info.color}; border: 1px solid {info.color}44;">{key}</span>
						<span class="text-sm font-medium" style="color: #f1f5f9;">{info.name}</span>
					</div>

					{#if syncData}
						<div class="space-y-1.5 text-xs" style="color: #94a3b8;">
							<div class="flex justify-between">
								<span>Status</span>
								<span class="flex items-center gap-1">
									{#if syncData.lastStatus === 'success'}
										<span style="color: #10b981;">✓ OK</span>
									{:else}
										<span style="color: #ef4444;">✗ Error</span>
									{/if}
								</span>
							</div>
							<div class="flex justify-between">
								<span>Last Run</span>
								<span style="color: #f1f5f9;">{timeAgo(syncData.lastRun)}</span>
							</div>
							<div class="flex justify-between">
								<span>Duration</span>
								<span style="color: #f1f5f9;">{formatDuration(syncData.lastDuration)}</span>
							</div>
							<div class="flex justify-between">
								<span>Records</span>
								<span style="color: #f1f5f9;">{syncData.lastRecords?.toLocaleString() ?? '—'}</span>
							</div>
							<div class="flex justify-between">
								<span>Total Runs</span>
								<span style="color: #f1f5f9;">{syncData.totalRuns}</span>
							</div>
						</div>
					{:else}
						<p class="text-xs" style="color: #475569;">No sync data yet</p>
					{/if}

					<button
						onclick={() => triggerSync(info.triggerType)}
						disabled={loadingType !== null}
						class="mt-3 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 transition-opacity"
						style="background: {info.color};"
					>
						{loadingType === info.triggerType ? 'Running...' : 'Run Now'}
					</button>
				</div>
			{/each}
		</div>
	</div>

	<!-- Recent Sync Logs -->
	<div class="rounded-xl overflow-hidden" style="background: #0d0d1f; border: 1px solid #1e293b;">
		<div class="px-4 py-3" style="border-bottom: 1px solid #1e293b;">
			<h2 class="text-sm font-semibold" style="color: #f1f5f9;">Recent Sync Logs</h2>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr style="border-bottom: 1px solid #1e293b; color: #64748b;">
						<th class="px-4 py-2 text-left font-medium">Time</th>
						<th class="px-4 py-2 text-left font-medium">Type</th>
						<th class="px-4 py-2 text-left font-medium">Status</th>
						<th class="px-4 py-2 text-right font-medium">Records</th>
						<th class="px-4 py-2 text-right font-medium">Flags</th>
						<th class="px-4 py-2 text-right font-medium">Duration</th>
						<th class="px-4 py-2 text-left font-medium">Error</th>
					</tr>
				</thead>
				<tbody>
					{#each data.recentLogs as log}
						{@const info = syncTypeMap[log.type]}
						<tr style="border-bottom: 1px solid #111827;">
							<td class="px-4 py-2" style="color: #94a3b8;">{timeAgo(log.createdAt)}</td>
							<td class="px-4 py-2">
								<span class="rounded px-1.5 py-0.5 text-[10px] font-bold" style="background: {info?.color ?? '#64748b'}22; color: {info?.color ?? '#94a3b8'};">{log.type}</span>
							</td>
							<td class="px-4 py-2">
								{#if log.status === 'success'}
									<span class="rounded px-1.5 py-0.5 text-[10px] font-bold" style="background: rgba(16,185,129,0.15); color: #10b981;">OK</span>
								{:else}
									<span class="rounded px-1.5 py-0.5 text-[10px] font-bold" style="background: rgba(239,68,68,0.15); color: #ef4444;">ERR</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-right" style="color: #f1f5f9;">{log.recordsProcessed?.toLocaleString() ?? '—'}</td>
							<td class="px-4 py-2 text-right" style="color: {log.flagsFound ? '#ef4444' : '#94a3b8'};">{log.flagsFound ?? '—'}</td>
							<td class="px-4 py-2 text-right" style="color: #94a3b8;">{formatDuration(log.duration)}</td>
							<td class="px-4 py-2 max-w-48 truncate" style="color: #ef4444;" title={log.error ?? ''}>{log.error ?? ''}</td>
						</tr>
					{/each}
					{#if data.recentLogs.length === 0}
						<tr>
							<td colspan="7" class="px-4 py-8 text-center" style="color: #64748b;">No sync logs yet.</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>
