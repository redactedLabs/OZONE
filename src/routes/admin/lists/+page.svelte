<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { safeHref } from '$lib/utils/safeHref';

	let { data } = $props();

	// Incident path: paste a hack's addresses → listed, traced and published within minutes
	let showIncidentForm = $state(false);
	let incName = $state('');
	let incUrl = $state('');
	let incNote = $state('');
	let incChain = $state('');
	let incAddresses = $state('');
	let incUrgent = $state(true);
	let incBusy = $state(false);
	let incResult = $state<{ listed?: Array<{ address: string; chain: string }>; invalid?: string[]; alreadyFlagged?: string[]; urgentUntil?: string | null; warnings?: string[]; error?: string } | null>(null);

	async function submitIncident() {
		if (!incAddresses.trim() || !incName.trim()) return;
		incBusy = true;
		incResult = null;
		try {
			const res = await fetch('/api/admin/flags', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					addresses: incAddresses,
					chain: incChain || undefined,
					incident: incName,
					refUrl: incUrl || undefined,
					note: incNote || undefined,
					urgent: incUrgent
				})
			});
			incResult = await res.json();
			if (res.ok) {
				incAddresses = '';
				await invalidateAll();
			}
		} catch (e) {
			incResult = { error: 'Request failed' };
		} finally {
			incBusy = false;
		}
	}

	let showAddForm = $state(false);
	let newAddress = $state('');
	let newChain = $state('ETH');
	let newReason = $state('');
	let adding = $state(false);

	const CHAINS = ['BTC', 'ETH', 'AVAX', 'BASE', 'BCH', 'BSC', 'DOGE', 'GAIA', 'LTC', 'SOL', 'THOR', 'TRON', 'XRP'];

	const sourceColors: Record<string, string> = {
		ofac_sdn: 'background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3)',
		uk_fcdo: 'background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25)',
		eu_fsf: 'background: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3)',
		chainalysis_oracle: 'background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3)',
		fbi: 'background: rgba(220,38,38,0.15); color: #dc2626; border: 1px solid rgba(220,38,38,0.3)',
		curated: 'background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3)',
		cluster: 'background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.25)',
		tether: 'background: rgba(38,161,123,0.15); color: #26a17b; border: 1px solid rgba(38,161,123,0.3)',
		circle: 'background: rgba(39,117,202,0.15); color: #2775ca; border: 1px solid rgba(39,117,202,0.3)',
		ethlabels: 'background: rgba(251,146,60,0.15); color: #fb923c; border: 1px solid rgba(251,146,60,0.3)',
		scamsniffer: 'background: rgba(236,72,153,0.15); color: #ec4899; border: 1px solid rgba(236,72,153,0.3)',
		manual: 'background: rgba(168,85,247,0.15); color: #a855f7; border: 1px solid rgba(168,85,247,0.3)',
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
		<div class="flex gap-2">
			<button
				onclick={() => showIncidentForm = !showIncidentForm}
				class="rounded-lg px-4 py-2 text-sm font-medium text-white transition-all"
				style="background: #dc2626;"
			>
				{showIncidentForm ? 'Cancel' : '+ Hack / incident'}
			</button>
			<button
				onclick={() => showAddForm = !showAddForm}
				class="rounded-lg px-4 py-2 text-sm font-medium text-white transition-all"
				style="background: #6366f1;"
			>
				{showAddForm ? 'Cancel' : '+ Add Manual Flag'}
			</button>
		</div>
	</div>

	<!-- Incident path: paste the addresses of a freshly announced hack -->
	{#if showIncidentForm}
		<div class="mb-6 rounded-xl p-5" style="background: #0d0d1f; border: 1px solid rgba(220,38,38,0.35);">
			<h3 class="text-sm font-semibold mb-1" style="color: #f1f5f9;">Hack / incident — list addresses now</h3>
			<p class="text-xs mb-3" style="color: #64748b;">
				The worker lists them within seconds, traces their THORChain flows before anything else and publishes a signed snapshot — usually within a few minutes.
				One address per line (or separated by commas); an optional <code>ETH:</code> / <code>BTC:</code> prefix sets the chain.
			</p>
			<div class="grid gap-3 md:grid-cols-3 mb-3">
				<input bind:value={incName} placeholder="Incident (e.g. Exchange X hack, 2026-09-27)" class="admin-input rounded-lg px-3 py-2 text-sm" />
				<input bind:value={incUrl} placeholder="Source URL (post-mortem, LE release, investigator post)" class="admin-input rounded-lg px-3 py-2 text-sm" />
				<select bind:value={incChain} class="admin-input rounded-lg px-3 py-2 text-sm">
					<option value="">Chain: auto-detect</option>
					{#each CHAINS as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</div>
			<textarea bind:value={incAddresses} rows="6" placeholder="0x…&#10;bc1q…&#10;ETH:0x…" class="admin-input w-full rounded-lg px-3 py-2 text-sm font-mono mb-3"></textarea>
			<div class="grid gap-3 md:grid-cols-3 items-center">
				<input bind:value={incNote} placeholder="Note (optional)" class="admin-input rounded-lg px-3 py-2 text-sm md:col-span-2" />
				<label class="text-xs flex items-center gap-2" style="color: #94a3b8;">
					<input type="checkbox" bind:checked={incUrgent} /> Trace and publish now (48 h priority)
				</label>
			</div>
			<div class="mt-3 flex items-center gap-3">
				<button
					onclick={submitIncident}
					disabled={incBusy || !incAddresses.trim() || !incName.trim()}
					class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					style="background: #dc2626;"
				>
					{incBusy ? 'Listing…' : 'List addresses'}
				</button>
				{#if incResult}
					<span class="text-xs" style="color: {incResult.error ? '#ef4444' : '#10b981'};">
						{#if incResult.error}
							{incResult.error}
						{:else}
							{incResult.listed?.length ?? 0} listed{incResult.urgentUntil ? ', urgent until ' + new Date(incResult.urgentUntil).toLocaleString() : ''}{incResult.alreadyFlagged?.length ? `, ${incResult.alreadyFlagged.length} already flagged` : ''}{incResult.invalid?.length ? `, ${incResult.invalid.length} invalid: ${incResult.invalid.slice(0, 5).join(', ')}` : ''}{incResult.warnings?.length ? ` — ${incResult.warnings.join('; ')}` : ''}
						{/if}
					</span>
				{/if}
			</div>
		</div>
	{/if}

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
	<div class="overflow-x-auto rounded-xl" style="background: #0d0d1f; border: 1px solid #1e293b;" data-win-title="Compliance Lists">
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
								<td class="px-4 py-3 text-xs" style="color: #f1f5f9;">
									{flag.reason}
									{#if flag.incident && flag.incident !== flag.reason}<span style="color: #94a3b8;"> · {flag.incident}</span>{/if}
									{#if safeHref(flag.refUrl)}<a href={safeHref(flag.refUrl)} target="_blank" rel="noopener noreferrer" class="ml-1" style="color: #6366f1;">source ↗</a>{/if}
									{#if flag.active && flag.urgentUntil && Date.parse(flag.urgentUntil) > Date.now()}<span class="ml-1" style="color: #dc2626;">urgent</span>{/if}
								</td>
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
