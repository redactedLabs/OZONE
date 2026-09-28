<script lang="ts">
	import { goto } from '$app/navigation';
	import { sourceLabel } from '$lib/utils/sourceNames';

	let { data } = $props();

	const riskColors: Record<string, string> = {
		severe: '#ef4444',
		high: '#f97316',
		medium: '#f59e0b',
		low: '#94a3b8',
		info: '#64748b'
	};
	const kindLabels: Record<string, string> = { listed: 'listed', traced: 'traced', linked: 'linked account', twin: 'same key' };

	let searchValue = $state(data.q || '');

	function setParam(name: string, value: string) {
		const url = new URL(window.location.href);
		if (value) url.searchParams.set(name, value);
		else url.searchParams.delete(name);
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function setList(list: 'all' | 'thor') {
		const url = new URL(window.location.origin + '/flagged');
		if (list === 'thor') url.searchParams.set('list', 'thor');
		goto(url.toString());
	}

	function pageHref(p: number): string {
		const params = new URLSearchParams();
		if (data.list === 'thor') params.set('list', 'thor');
		if (data.q) params.set('q', data.q);
		if (data.source) params.set('source', data.source);
		if (data.chain) params.set('chain', data.chain);
		params.set('page', String(p));
		return `?${params.toString()}`;
	}

	const csvHref = $derived.by(() => {
		const params = new URLSearchParams({ list: data.list, format: 'csv' });
		if (data.q) params.set('q', data.q);
		if (data.source) params.set('source', data.source);
		if (data.chain && data.list !== 'thor') params.set('chain', data.chain);
		return `/api/flagged?${params.toString()}`;
	});

	function truncate(s: string, len = 20): string {
		return s.length > len ? s.slice(0, len) + '…' : s;
	}

	let copiedAddr = $state('');
	function copyAddress(addr: string) {
		navigator.clipboard.writeText(addr);
		copiedAddr = addr;
		setTimeout(() => {
			copiedAddr = '';
		}, 2000);
	}
</script>

<svelte:head>
	<title>{data.list === 'thor' ? 'Flagged THORChain Addresses' : 'Flagged Addresses'} | Ozone</title>
	<meta name="description" content="Every address Ozone flags (risk high or above) in its signed snapshot, on every chain, and the THORChain (thor1) addresses among them — with risk, reason codes, sources and incident." />
	<meta property="og:url" content="https://ozone.redacted.gg/flagged" />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="mb-6">
		<h1 class="text-2xl font-bold" style="color: var(--text);">{data.list === 'thor' ? 'Flagged THORChain (thor1) Addresses' : 'Flagged Addresses'}</h1>
		<p class="text-sm mt-1" style="color: var(--text-muted);">
			{data.list === 'thor' ? data.definitions.flaggedThorAddresses : data.definitions.flaggedAddresses}
			{#if data.snapshot}
				From {data.snapshot.signed ? 'signed' : 'unsigned'} snapshot v{data.snapshot.version} ({new Date(data.snapshot.builtAt).toLocaleString()}).
			{/if}
			<a href="/methodology#numbers" style="color: var(--app-accent);">What the numbers mean</a>.
		</p>
	</div>

	{#if !data.ready}
		<div class="rounded-xl p-8 text-center text-sm" style="background: var(--bg-card); border: 1px solid var(--app-border); color: var(--text-muted);">
			No snapshot has been published yet.
		</div>
	{:else}
		<!-- The two lists -->
		<div class="mb-4 flex flex-wrap gap-2">
			<button onclick={() => setList('all')} class="source-tab" class:active={data.list === 'all'}>
				All flagged addresses <span class="tab-count">{data.counts.flaggedAddresses.toLocaleString('en-US')}</span>
			</button>
			<button onclick={() => setList('thor')} class="source-tab" class:active={data.list === 'thor'}>
				Flagged thor1 addresses <span class="tab-count">{data.counts.flaggedThorAddresses.toLocaleString('en-US')}</span>
			</button>
			<a href="/screening" class="source-tab" style="text-decoration: none;" title={data.definitions.monitoredThorAccountsFlagged}>
				Monitored thor1 accounts flagged {#if data.monitoredFlagged !== null}<span class="tab-count">{data.monitoredFlagged.toLocaleString('en-US')}</span>{/if} &#8599;
			</a>
		</div>

		<!-- How they are flagged -->
		<p class="mb-3 text-xs" style="color: var(--text-muted);">
			{data.byKind.listed.toLocaleString('en-US')} listed · {data.byKind.traced.toLocaleString('en-US')} traced through THORChain · {data.byKind.linked.toLocaleString('en-US')} linked accounts · {data.byKind.twin.toLocaleString('en-US')} same key as a listing
		</p>

		<!-- Source filter -->
		<div class="mb-3 flex flex-wrap gap-2">
			<button onclick={() => setParam('source', '')} class="source-tab" class:active={!data.source}>All sources</button>
			{#each data.bySource as s}
				<button onclick={() => setParam('source', s.source)} class="source-tab" class:active={data.source === s.source}>
					{sourceLabel(s.source)} <span class="tab-count">{s.keys.toLocaleString('en-US')}</span>
				</button>
			{/each}
		</div>

		<!-- Chain filter (all-chains list only) -->
		{#if data.list === 'all' && data.byChain.length}
			<div class="mb-3 flex flex-wrap gap-2">
				<button onclick={() => setParam('chain', '')} class="source-tab" class:active={!data.chain}>All chains</button>
				{#each data.byChain as c}
					<button onclick={() => setParam('chain', c.chain)} class="source-tab" class:active={data.chain === c.chain}>
						{c.chain} <span class="tab-count">{c.keys.toLocaleString('en-US')}</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Search + download -->
		<div class="mb-4 flex gap-2">
			<input
				type="text"
				bind:value={searchValue}
				placeholder="Search by address or incident..."
				class="flagged-input flex-1 rounded-lg px-4 py-2 text-sm"
				onkeydown={(e) => {
					if (e.key === 'Enter') setParam('q', searchValue.trim());
				}}
			/>
			<button onclick={() => setParam('q', searchValue.trim())} class="rounded-lg px-3 py-2 text-sm font-medium text-white" style="background: var(--app-accent);">Search</button>
			<a href={csvHref} class="source-tab" style="text-decoration: none;">CSV</a>
		</div>

		<div class="overflow-x-auto rounded-xl" style="background: var(--bg-card); border: 1px solid var(--app-border);" data-win-title="Flagged Addresses">
			<table class="w-full text-left text-sm">
				<thead>
					<tr style="border-bottom: 1px solid var(--app-border);">
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Address</th>
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Chain</th>
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Risk</th>
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">How</th>
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Reason codes</th>
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Sources</th>
						<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Incident / entity</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.chain + row.address)}
						<tr style="border-bottom: 1px solid var(--app-border-subtle);">
							<td class="px-4 py-3">
								<button onclick={() => copyAddress(row.address)} class="font-mono text-xs" style="color: var(--text);" title={row.address}>
									{truncate(row.address, 26)}
									{#if copiedAddr === row.address}<span class="ml-1" style="color: #10b981;">Copied</span>{/if}
								</button>
								<a href="/api/v1/address/{encodeURIComponent(row.address)}" target="_blank" rel="noopener" class="ml-1 text-[10px]" style="color: var(--app-accent);" title="All reasons with evidence (JSON)">evidence&nbsp;&#8599;</a>
							</td>
							<td class="px-4 py-3 text-xs" style="color: var(--text-muted);">{row.chain}</td>
							<td class="px-4 py-3 text-xs font-semibold" style="color: {riskColors[row.risk] ?? 'var(--text-muted)'};">{row.risk}</td>
							<td class="px-4 py-3 text-xs" style="color: var(--text-muted);">{kindLabels[row.kind] ?? row.kind}</td>
							<td class="px-4 py-3 font-mono text-[10px]" style="color: var(--text);">{row.codes.join(' ')}</td>
							<td class="px-4 py-3 text-xs" style="color: var(--text-muted);">{row.sources.map(sourceLabel).join(', ')}</td>
							<td class="px-4 py-3 text-xs" style="color: var(--text);" title={row.incident ?? ''}>{truncate(row.incident ?? '—', 48)}</td>
						</tr>
					{/each}
					{#if data.rows.length === 0}
						<tr><td colspan="7" class="px-4 py-12 text-center" style="color: var(--text-muted);">No flagged addresses match.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

		{#if data.total > data.perPage}
			<div class="mt-4 flex items-center justify-center gap-2">
				{#if data.page > 1}<a href={pageHref(data.page - 1)} class="page-btn">Previous</a>{/if}
				<span class="text-sm" style="color: var(--text-muted);">Page {data.page} of {Math.ceil(data.total / data.perPage)} · {data.total.toLocaleString('en-US')} addresses</span>
				{#if data.page * data.perPage < data.total}<a href={pageHref(data.page + 1)} class="page-btn">Next</a>{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.flagged-input {
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
		outline: none;
	}
	.flagged-input:focus {
		border-color: var(--app-accent);
	}
	.flagged-input::placeholder {
		color: var(--text-faint);
	}
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
	.source-tab:hover {
		color: var(--text);
		border-color: var(--text-ghost);
	}
	.source-tab.active {
		color: var(--text);
		background: rgba(99, 102, 241, 0.15);
		border-color: var(--app-accent);
	}
	.tab-count {
		margin-left: 4px;
		font-family: ui-monospace, monospace;
	}
	.page-btn {
		padding: 4px 12px;
		font-size: 13px;
		border-radius: 8px;
		color: var(--text-muted);
		border: 1px solid var(--app-border);
	}
</style>
