<script lang="ts">
	let { data } = $props();

	let expandedRows = $state(new Set<string>());

	function toggleRow(addr: string) {
		if (expandedRows.has(addr)) {
			expandedRows.delete(addr);
		} else {
			expandedRows.add(addr);
		}
		expandedRows = new Set(expandedRows);
	}

	function exportCSV() {
		const headers = ['Thor Address', 'Flag Reason', 'Screened At', 'Match Source', 'Entity Name', 'L1 Address', 'Chain'];
		const rows = data.results.flatMap((r: any) =>
			r.matches.length > 0
				? r.matches.map((m: any) => [
						r.thorAddress,
						r.flagReason || '',
						r.screenedAt || '',
						m.source,
						m.entityName || '',
						m.l1Address,
						m.chain
					])
				: [[r.thorAddress, r.flagReason || '', r.screenedAt || '', '', '', '', '']]
		);

		const csv = [headers, ...rows].map((row) =>
			row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
		).join('\n');

		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `screening-results-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const sourceColors: Record<string, string> = {
		OFAC: 'bg-red-500/20 text-red-400 border-red-500/30',
		EU: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
		HACK: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
		CHAINALYSIS: 'bg-purple-500/20 text-purple-400 border-purple-500/30'
	};
</script>

<svelte:head>
	<title>Screening — Redacted Compliance</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-[var(--text)]">Screening Results</h1>
			<p class="mt-1 text-sm text-[var(--text-muted)]">
				{data.flaggedCount} flagged of {data.totalUsers} total users
			</p>
		</div>
		<button
			onclick={exportCSV}
			class="rounded-lg border border-[var(--app-border)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]"
		>
			Export CSV
		</button>
	</div>

	<!-- Summary Cards -->
	<div class="mb-6 grid grid-cols-3 gap-4">
		<div class="rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-4">
			<div class="text-2xl font-bold text-[var(--text)]">{data.totalUsers}</div>
			<div class="text-sm text-[var(--text-muted)]">Total Screened</div>
		</div>
		<div class="rounded-xl border border-[var(--danger)]/20 bg-[var(--bg-card)] p-4">
			<div class="text-2xl font-bold text-[var(--danger)]">{data.flaggedCount}</div>
			<div class="text-sm text-[var(--text-muted)]">Flagged</div>
		</div>
		<div class="rounded-xl border border-[var(--success)]/20 bg-[var(--bg-card)] p-4">
			<div class="text-2xl font-bold text-[var(--success)]">{data.cleanCount}</div>
			<div class="text-sm text-[var(--text-muted)]">Clean</div>
		</div>
	</div>

	<!-- Results Table -->
	<div class="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)]" data-win-title="Screening Results">
		{#if data.results.length === 0}
			<div class="p-12 text-center text-[var(--text-muted)]">
				{#if data.totalUsers === 0}
					No users found. Run a sync first.
				{:else}
					No flagged addresses found. All {data.totalUsers} users are clean.
				{/if}
			</div>
		{:else}
			{#each data.results as result}
				<div class="border-b border-[var(--app-border)] last:border-b-0">
					<!-- Main Row -->
					<button
						onclick={() => toggleRow(result.thorAddress)}
						class="flex w-full items-center gap-4 border-l-2 border-l-[var(--danger)] p-4 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
					>
						<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]"></span>
						<div class="min-w-0 flex-1">
							<p class="truncate font-mono text-sm text-[var(--text)]">
								{result.thorAddress}
							</p>
							<p class="mt-0.5 truncate text-xs text-[var(--text-muted)]">
								{result.flagReason || 'Unknown reason'}
							</p>
						</div>
						<div class="flex items-center gap-3">
							<span class="rounded bg-[var(--danger)]/20 px-2 py-0.5 text-xs text-[var(--danger)]">
								{result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
							</span>
							<span class="text-xs text-[var(--text-muted)]">
								{result.screenedAt
									? new Date(result.screenedAt).toLocaleDateString()
									: ''}
							</span>
							<span
								class="transition-transform {expandedRows.has(result.thorAddress) ? 'rotate-90' : ''}"
							>
								&#9654;
							</span>
						</div>
					</button>

					<!-- Expanded Details -->
					{#if expandedRows.has(result.thorAddress)}
						<div class="border-t border-[var(--app-border)] bg-[var(--bg)]/50 px-4 py-3">
							<table class="w-full text-xs">
								<thead>
									<tr class="text-[var(--text-muted)]">
										<th class="pb-2 text-left font-medium">Source</th>
										<th class="pb-2 text-left font-medium">Entity</th>
										<th class="pb-2 text-left font-medium">L1 Address</th>
										<th class="pb-2 text-left font-medium">Chain</th>
										<th class="pb-2 text-left font-medium">Reason</th>
									</tr>
								</thead>
								<tbody>
									{#each result.matches as match}
										<tr class="border-t border-[var(--app-border)]/50">
											<td class="py-2">
												<span
													class="inline-block rounded border px-2 py-0.5 text-xs font-medium {sourceColors[match.source] || 'bg-gray-500/20 text-gray-400'}"
												>
													{match.source}
												</span>
											</td>
											<td class="py-2 text-[var(--text)]">{match.entityName || '—'}</td>
											<td class="py-2 font-mono text-[var(--text-muted)]">
												{match.l1Address.slice(0, 12)}...{match.l1Address.slice(-6)}
											</td>
											<td class="py-2 text-[var(--text-muted)]">{match.chain}</td>
											<td class="py-2 text-[var(--text-muted)]">{match.reason || '—'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
