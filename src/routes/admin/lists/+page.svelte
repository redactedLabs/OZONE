<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { data } = $props();

	let showAddForm = $state(false);
	let newAddress = $state('');
	let newChain = $state('ETH');
	let newReason = $state('');
	let adding = $state(false);

	const CHAINS = ['BTC', 'ETH', 'AVAX', 'BASE', 'BCH', 'BSC', 'DOGE', 'GAIA', 'LTC', 'SOL', 'THOR', 'TRON', 'XRP'];

	const sourceColors: Record<string, string> = {
		OFAC: 'background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3)',
		EU: 'background: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3)',
		HACK: 'background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3)',
		MANUAL: 'background: rgba(168,85,247,0.15); color: #a855f7; border: 1px solid rgba(168,85,247,0.3)',
		CHAINALYSIS: 'background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3)',
		TETHER: 'background: rgba(38,161,123,0.15); color: #26a17b; border: 1px solid rgba(38,161,123,0.3)',
		SCAM: 'background: rgba(236,72,153,0.15); color: #ec4899; border: 1px solid rgba(236,72,153,0.3)',
		ETH_LABELS: 'background: rgba(251,146,60,0.15); color: #fb923c; border: 1px solid rgba(251,146,60,0.3)',
	};

	function setSource(s: string) {
		const url = new URL(window.location.href);
		if (s) url.searchParams.set('source', s);
		else url.searchParams.delete('source');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function search(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		const url = new URL(window.location.href);
		if (val) url.searchParams.set('search', val);
		else url.searchParams.delete('search');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	async function addManualFlag() {
		if (!newAddress || !newReason) return;
		adding = true;
		try {
			await fetch('/api/admin/flags', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: newAddress, chain: newChain, reason: newReason })
			});
			newAddress = '';
			newReason = '';
			showAddForm = false;
			await invalidateAll();
		} catch (e) {
			alert('Failed to add flag');
		} finally {
			adding = false;
		}
	}

	async function removeFlag(id: number) {
		await fetch('/api/admin/flags', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		await invalidateAll();
	}

	function truncate(s: string, len = 20): string {
		return s.length > len ? s.slice(0, len) + '...' : s;
	}
</script>

<svelte:head>
	<title>Compliance Lists — Admin</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="flex items-end justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold" style="color: #f1f5f9;">Compliance Lists</h1>
			<p class="text-sm mt-1" style="color: #64748b;">
				{data.total.toLocaleString()} total entries across all lists
			</p>
		</div>
		<button
			onclick={() => showAddForm = !showAddForm}
			class="rounded-lg px-4 py-2 text-sm font-medium text-white transition-all"
			style="background: #6366f1;"
		>
			{showAddForm ? 'Cancel' : '+ Add Manual Flag'}
		</button>
	</div>

	<!-- Add Manual Flag Form -->
	{#if showAddForm}
		<div class="mb-6 rounded-xl p-5" style="background: #0d0d1f; border: 1px solid rgba(168,85,247,0.3);">
			<h3 class="text-sm font-semibold mb-3" style="color: #f1f5f9;">Add Manual Flag</h3>
			<div class="grid gap-3 md:grid-cols-4">
				<input
					bind:value={newAddress}
					placeholder="Address (0x..., bc1..., thor1...)"
					class="admin-input rounded-lg px-3 py-2 text-sm"
				/>
				<select bind:value={newChain} class="admin-input rounded-lg px-3 py-2 text-sm">
					{#each CHAINS as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
				<input
					bind:value={newReason}
					placeholder="Reason (e.g. Lazarus Group)"
					class="admin-input rounded-lg px-3 py-2 text-sm"
				/>
				<button
					onclick={addManualFlag}
					disabled={adding || !newAddress || !newReason}
					class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					style="background: #a855f7;"
				>
					{adding ? 'Adding...' : 'Add Flag'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Source Filter Tabs -->
	<div class="mb-4 flex flex-wrap gap-2">
		<button onclick={() => setSource('')}
			class="source-tab" class:active={!data.source}>
			All ({data.total.toLocaleString()})
		</button>
		{#each Object.entries(data.sourceCounts) as [src, count]}
			<button onclick={() => setSource(src)}
				class="source-tab" class:active={data.source === src}>
				<span class="inline-block rounded px-1.5 py-0.5 text-[10px] mr-1" style={sourceColors[src] || ''}>{src}</span>
				{count.toLocaleString()}
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="mb-4">
		<input
			type="text"
			value={data.search}
			oninput={search}
			placeholder="Search by address..."
			class="admin-input w-full rounded-lg px-4 py-2 text-sm"
		/>
	</div>

	<!-- Entries Table -->
	<div class="overflow-x-auto rounded-xl" style="background: #0d0d1f; border: 1px solid #1e293b;">
		<table class="w-full text-left text-sm">
			<thead>
				<tr style="border-bottom: 1px solid #1e293b;">
					<th class="px-4 py-3 font-medium" style="color: #64748b;">Source</th>
					<th class="px-4 py-3 font-medium" style="color: #64748b;">Address</th>
					<th class="px-4 py-3 font-medium" style="color: #64748b;">Chain</th>
					<th class="px-4 py-3 font-medium" style="color: #64748b;">Entity</th>
					<th class="px-4 py-3 font-medium" style="color: #64748b;">Reason</th>
					<th class="px-4 py-3 font-medium" style="color: #64748b;">Last Seen</th>
				</tr>
			</thead>
			<tbody>
				{#each data.entries as entry}
					<tr style="border-bottom: 1px solid var(--app-border-subtle);">
						<td class="px-4 py-3">
							<span class="inline-block rounded px-2 py-0.5 text-[10px] font-semibold" style={sourceColors[entry.source] || ''}>{entry.source}</span>
						</td>
						<td class="px-4 py-3 font-mono text-xs" style="color: #f1f5f9;" title={entry.address}>
							{truncate(entry.address, 24)}
						</td>
						<td class="px-4 py-3 text-xs" style="color: #64748b;">{entry.chain || '—'}</td>
						<td class="px-4 py-3 text-xs" style="color: #f1f5f9;">{truncate(entry.entityName || '—', 30)}</td>
						<td class="px-4 py-3 text-xs" style="color: #64748b;">{truncate(entry.reason || '—', 40)}</td>
						<td class="px-4 py-3 text-xs" style="color: #64748b;">
							{entry.lastSeen ? new Date(entry.lastSeen).toLocaleDateString() : '—'}
						</td>
					</tr>
				{/each}
				{#if data.entries.length === 0}
					<tr><td colspan="6" class="px-4 py-12 text-center" style="color: #64748b;">No entries found.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if data.total > data.perPage}
		<div class="mt-4 flex items-center justify-center gap-2">
			{#if data.page > 1}
				<a href="?source={data.source}&search={data.search}&page={data.page - 1}" class="page-btn">Previous</a>
			{/if}
			<span class="text-sm" style="color: #64748b;">Page {data.page} of {Math.ceil(data.total / data.perPage)}</span>
			{#if data.page * data.perPage < data.total}
				<a href="?source={data.source}&search={data.search}&page={data.page + 1}" class="page-btn">Next</a>
			{/if}
		</div>
	{/if}

	<!-- Manual Flags Section -->
	{#if data.manualFlags.length > 0}
		<div class="mt-8">
			<h2 class="text-lg font-semibold mb-4" style="color: #f1f5f9;">Manual Flags ({data.manualFlags.length})</h2>
			<div class="overflow-x-auto rounded-xl" style="background: #0d0d1f; border: 1px solid rgba(168,85,247,0.2);">
				<table class="w-full text-left text-sm">
					<thead>
						<tr style="border-bottom: 1px solid #1e293b;">
							<th class="px-4 py-3 font-medium" style="color: #64748b;">Address</th>
							<th class="px-4 py-3 font-medium" style="color: #64748b;">Chain</th>
							<th class="px-4 py-3 font-medium" style="color: #64748b;">Reason</th>
							<th class="px-4 py-3 font-medium" style="color: #64748b;">Added By</th>
							<th class="px-4 py-3 font-medium" style="color: #64748b;">Status</th>
							<th class="px-4 py-3 font-medium" style="color: #64748b;"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.manualFlags as flag}
							<tr style="border-bottom: 1px solid var(--app-border-subtle);">
								<td class="px-4 py-3 font-mono text-xs" style="color: #f1f5f9;">{truncate(flag.address, 24)}</td>
								<td class="px-4 py-3 text-xs" style="color: #64748b;">{flag.chain || '—'}</td>
								<td class="px-4 py-3 text-xs" style="color: #f1f5f9;">{flag.reason}</td>
								<td class="px-4 py-3 text-xs" style="color: #64748b;">{flag.addedBy || '—'}</td>
								<td class="px-4 py-3">
									{#if flag.active}
										<span class="text-xs" style="color: #ef4444;">Active</span>
									{:else}
										<span class="text-xs" style="color: #64748b;">Removed</span>
									{/if}
								</td>
								<td class="px-4 py-3">
									{#if flag.active}
										<button onclick={() => removeFlag(flag.id)} class="text-xs" style="color: #ef4444;">Remove</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-input {
		background: #060610;
		border: 1px solid #1e293b;
		color: #f1f5f9;
		outline: none;
	}
	.admin-input:focus { border-color: #6366f1; }
	.admin-input::placeholder { color: #475569; }
	.source-tab {
		padding: 6px 12px;
		font-size: 12px;
		border-radius: 8px;
		color: #64748b;
		background: #0d0d1f;
		border: 1px solid #1e293b;
		cursor: pointer;
		transition: all 0.2s;
	}
	.source-tab:hover { color: #f1f5f9; border-color: #334155; }
	.source-tab.active { color: #f1f5f9; background: rgba(99,102,241,0.15); border-color: #6366f1; }
	.page-btn {
		padding: 4px 12px;
		font-size: 13px;
		border-radius: 8px;
		color: #64748b;
		border: 1px solid #1e293b;
	}
</style>
