<script lang="ts">
	import { goto } from '$app/navigation';
	import { safeHref } from '$lib/utils/safeHref';

	let { data } = $props();

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
	const riskColors: Record<string, string> = {
		severe: '#ef4444',
		high: '#f97316',
		medium: '#f59e0b',
		low: '#94a3b8',
		info: '#64748b'
	};

	function toggleHistory() {
		const url = new URL(window.location.href);
		if (data.history) url.searchParams.delete('history');
		else url.searchParams.set('history', '1');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	let searchValue = $state(data.search || '');

	function setSource(s: string) {
		const url = new URL(window.location.href);
		if (s) url.searchParams.set('source', s);
		else url.searchParams.delete('source');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function toggleSort() {
		const url = new URL(window.location.href);
		url.searchParams.set('sort', data.sort === 'newest' ? 'oldest' : 'newest');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function doSearch() {
		const url = new URL(window.location.href);
		if (searchValue.trim()) url.searchParams.set('search', searchValue.trim());
		else url.searchParams.delete('search');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function truncate(s: string, len = 20): string {
		return s.length > len ? s.slice(0, len) + '...' : s;
	}

	function compact(n: number): string {
		if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
		if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
		return n.toString();
	}

	let copiedAddr = $state('');
	function copyAddress(addr: string) {
		navigator.clipboard.writeText(addr);
		copiedAddr = addr;
		setTimeout(() => { copiedAddr = ''; }, 2000);
	}
</script>

<svelte:head>
	<title>Listed Addresses — OFAC, UK, EU, FBI, Tether, Circle | Ozone</title>
	<meta name="description" content="Every address Ozone lists, with its source and provenance: OFAC SDN, UK and EU sanctions, FBI attributions, Tether and Circle freezes, hack clusters, exploiter and phishing lists. Delisted addresses kept as history." />
	<meta property="og:title" content="Listed Crypto Addresses — Ozone" />
	<meta property="og:description" content="Sanctions, law-enforcement attributions, stablecoin freezes and hack lists — with provenance for every entry." />
	<meta property="og:url" content="https://ozone.redacted.gg/banned" />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="mb-6">
		<h1 class="text-2xl font-bold" style="color: var(--text);">Listed Addresses</h1>
		<p class="text-sm mt-1" style="color: var(--text-muted);">
			{data.totalAll.toLocaleString()} distinct addresses currently listed by at least one source.
			{#if data.history}Showing <strong>history</strong>: delisted / unfrozen entries, which no longer flag.{/if}
			Addresses flagged by THORChain tracing are not listed here — screen them on the <a href="/certificate" style="color: var(--app-accent);">certificate page</a> or via the <a href="/api-docs" style="color: var(--app-accent);">API</a>.
			<a href="/methodology" style="color: var(--app-accent);">Methodology</a>.
		</p>
	</div>

	<!-- Source Filter Tabs -->
	<div class="mb-4 flex flex-wrap gap-2">
		<button onclick={() => setSource('')}
			class="source-tab" class:active={!data.source}>
			All <span class="tab-count">{data.totalAll.toLocaleString()}</span><span class="tab-count-mobile">{compact(data.totalAll)}</span>
		</button>
		{#each Object.entries(data.sourceCounts) as [src, cnt]}
			<button onclick={() => setSource(src)}
				class="source-tab" class:active={data.source === src}>
				<span class="inline-block rounded px-1.5 py-0.5 text-[10px] mr-1" style={sourceColors[src] || ''}>{data.sourceNames[src] ?? src}</span>
				<span class="tab-count">{(cnt as number).toLocaleString()}</span><span class="tab-count-mobile">{compact(cnt as number)}</span>
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="mb-4 flex gap-2">
		<input
			type="text"
			bind:value={searchValue}
			placeholder="Search by address..."
			class="banned-input flex-1 rounded-lg px-4 py-2 text-sm"
			onkeydown={(e) => { if (e.key === 'Enter') doSearch(); }}
		/>
		<button onclick={doSearch} class="rounded-lg px-3 py-2 text-sm font-medium text-white" style="background: var(--app-accent);">Search</button>
		<button onclick={toggleHistory} class="source-tab" class:active={data.history}>{data.history ? 'Current' : 'History'}</button>
	</div>

	<!-- Entries Table -->
	<div class="overflow-x-auto rounded-xl" style="background: var(--bg-card); border: 1px solid var(--app-border);" data-win-title="Sanctioned List">
		<table class="w-full text-left text-sm">
			<thead>
				<tr style="border-bottom: 1px solid var(--app-border);">
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Source</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Address</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Chain</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Risk</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Entity / reason</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">
						<button onclick={toggleSort} class="sort-btn">
							Listed {data.sort === 'newest' ? '↓' : '↑'}
						</button>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each data.entries as entry}
					<tr style="border-bottom: 1px solid var(--app-border-subtle);">
						<td class="px-4 py-3">
							<span class="inline-block rounded px-2 py-0.5 text-[10px] font-semibold" style={sourceColors[entry.source] || ''}>{entry.sourceName}</span>
						</td>
						<td class="px-4 py-3">
							<button
								onclick={() => copyAddress(entry.address)}
								class="font-mono text-xs transition-colors"
								style="color: var(--text);"
								title="Click to copy"
							>
								{truncate(entry.address, 24)}
								{#if copiedAddr === entry.address}
									<span class="ml-1" style="color: #10b981;">Copied</span>
								{/if}
							</button>
						</td>
						<td class="px-4 py-3 text-xs" style="color: var(--text-muted);">{entry.chain || '--'}</td>
						<td class="px-4 py-3 text-xs font-semibold" style="color: {riskColors[entry.risk] ?? 'var(--text-muted)'};">{entry.removedAt ? 'history' : entry.risk}</td>
						<td class="px-4 py-3 text-xs" style="color: var(--text);" title={entry.reason}>
							<div>{truncate(entry.entityName || '--', 36)}</div>
							<div style="color: var(--text-muted);">
								{truncate(entry.reason || '', 60)}
								{#if safeHref(entry.ref)}<a href={safeHref(entry.ref)} target="_blank" rel="noopener" style="color: var(--app-accent);"> source&nbsp;&#8599;</a>{/if}
							</div>
						</td>
						<td class="px-4 py-3 text-xs" style="color: var(--text-muted);" title={`First seen by Ozone ${new Date(entry.addedAt).toLocaleDateString()}${entry.removedAt ? ` · removed ${new Date(entry.removedAt).toLocaleDateString()}` : ''}`}>
							{new Date(entry.listedAt ?? entry.addedAt).toLocaleDateString()}
							{#if entry.removedAt}<div style="color: #10b981;">removed {new Date(entry.removedAt).toLocaleDateString()}</div>{/if}
						</td>
					</tr>
				{/each}
				{#if data.entries.length === 0}
					<tr><td colspan="6" class="px-4 py-12 text-center" style="color: var(--text-muted);">No entries found.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if data.total > data.perPage}
		<div class="mt-4 flex items-center justify-center gap-2">
			{#if data.page > 1}
				<a href="?source={data.source}&search={data.search}&sort={data.sort}&page={data.page - 1}{data.history ? '&history=1' : ''}" class="page-btn">Previous</a>
			{/if}
			<span class="text-sm" style="color: var(--text-muted);">Page {data.page} of {Math.ceil(data.total / data.perPage)}</span>
			{#if data.page * data.perPage < data.total}
				<a href="?source={data.source}&search={data.search}&sort={data.sort}&page={data.page + 1}{data.history ? '&history=1' : ''}" class="page-btn">Next</a>
			{/if}
		</div>
	{/if}
</div>

<style>
	.banned-input {
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
		outline: none;
	}
	.banned-input:focus { border-color: var(--app-accent); }
	.banned-input::placeholder { color: var(--text-faint); }
	.source-tab {
		padding: 6px 12px;
		font-size: 12px;
		border-radius: 8px;
		color: var(--text-muted);
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		cursor: pointer;
		transition: all 0.2s;
	}
	.source-tab:hover { color: var(--text); border-color: var(--text-ghost); }
	.source-tab.active { color: var(--text); background: rgba(99,102,241,0.15); border-color: var(--app-accent); }
	.tab-count-mobile { display: none; }
	@media (max-width: 640px) {
		.tab-count { display: none; }
		.tab-count-mobile { display: inline; }
	}
	.sort-btn {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 14px;
		cursor: pointer;
		transition: color 0.15s;
	}
	.sort-btn:hover { color: var(--text); }
	.page-btn {
		padding: 4px 12px;
		font-size: 13px;
		border-radius: 8px;
		color: var(--text-muted);
		border: 1px solid var(--app-border);
	}
</style>
