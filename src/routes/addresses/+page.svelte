<script lang="ts">
	import { goto } from '$app/navigation';
	import { fetchPoolChains, getChainLogo, getChainColor, CHAIN_COLORS } from '$lib/utils/tokenLogos';

	let { data } = $props();

	let searchQuery = $state(data.search || '');
	let selectedUser = $state<any>(null);
	let copiedAddr = $state('');
	let dynamicChains = $state<string[]>([]);

	// Static fallback chains used until pools load
	const staticChains = ['BTC', 'ETH', 'SOL', 'DOGE', 'LTC', 'BCH', 'AVAX', 'BSC', 'BASE', 'GAIA', 'TRON', 'XRP', 'THOR'];

	// Load dynamic chains from Midgard pools
	fetchPoolChains().then((chains) => { dynamicChains = chains; });

	// Merge: dynamic pools + static fallbacks (deduped, sorted)
	function getChains(): string[] {
		const all = new Set([...dynamicChains, ...staticChains]);
		return [...all].sort();
	}

	// Fallback text icons
	const chainIcons: Record<string, string> = {
		BTC: '₿', ETH: 'Ξ', SOL: 'S', DOGE: 'Ð', LTC: 'Ł', BCH: '₿',
		AVAX: 'A', BSC: 'B', BASE: 'B', GAIA: '⚛', TRON: 'T', XRP: 'X', THOR: 'ᚦ', XMR: 'ɱ', UNKNOWN: '?'
	};

	function chainLogo(chain: string): string | undefined {
		return getChainLogo(chain);
	}

	function chainColor(chain: string): string {
		return getChainColor(chain);
	}

	function setFilter(f: string) {
		const url = new URL(window.location.href);
		url.searchParams.set('filter', f);
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function setChain(c: string) {
		const url = new URL(window.location.href);
		if (c) url.searchParams.set('chain', c);
		else url.searchParams.delete('chain');
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	function copyAddress(addr: string) {
		navigator.clipboard.writeText(addr);
		copiedAddr = addr;
		setTimeout(() => { copiedAddr = ''; }, 2000);
	}

	function truncate(addr: string): string {
		if (addr.length <= 16) return addr;
		return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
	}

	function getUniqueChains(l1s: any[]): string[] {
		return [...new Set(l1s.map((l: any) => l.chain))];
	}

	function doSearch() {
		const url = new URL(window.location.href);
		if (searchQuery.trim()) {
			url.searchParams.set('search', searchQuery.trim());
		} else {
			url.searchParams.delete('search');
		}
		url.searchParams.set('page', '1');
		goto(url.toString());
	}

	// Use server-filtered data directly
	const filteredUsers = $derived(data.users);
</script>

<svelte:head>
	<title>Addresses — Ozone</title>
</svelte:head>

<!-- Address Detail Popup -->
{#if selectedUser}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[999] flex items-center justify-center"
		style="background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);"
		onclick={() => selectedUser = null}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-lg rounded-2xl p-6 mx-4"
			style="background: var(--bg-card); border: 1px solid var(--app-border);"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between mb-5">
				<h3 class="text-lg font-semibold" style="color: var(--text);">Linked Addresses</h3>
				<button
					onclick={() => selectedUser = null}
					class="text-xl"
					style="color: var(--text-muted);"
				>&times;</button>
			</div>

			<!-- Thor Address -->
			<div class="mb-4 p-3 rounded-lg" style="background: var(--bg); border: 1px solid var(--app-border);">
				<div class="text-xs mb-1" style="color: var(--text-muted);">THORChain Address</div>
				<button
					onclick={() => copyAddress(selectedUser.thorAddress)}
					class="font-mono text-sm break-all text-left"
					style="color: var(--text);"
				>
					{selectedUser.thorAddress}
					{#if copiedAddr === selectedUser.thorAddress}
						<span class="ml-2 text-xs" style="color: #10b981;">Copied!</span>
					{/if}
				</button>
			</div>

			<!-- L1 Addresses -->
			{#if selectedUser.l1Addresses.length === 0}
				<p class="text-sm py-4 text-center" style="color: var(--text-muted);">
					No linked L1 addresses found yet. Run L1 address sync.
				</p>
			{:else}
				<div class="text-xs mb-2" style="color: var(--text-muted);">
					Deposit addresses discovered via Midgard pool participation:
				</div>
				<div class="space-y-2 max-h-80 overflow-y-auto">
					{#each selectedUser.l1Addresses as l1}
						<div class="flex items-center gap-3 p-3 rounded-lg" style="background: var(--bg); border: 1px solid var(--app-border);">
							<span
								class="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
								style={chainColor(l1.chain)}
							>
								{#if chainLogo(l1.chain)}
									<img src={chainLogo(l1.chain)} alt={l1.chain} class="w-5 h-5 rounded-full" />
								{:else}
									<span class="text-sm font-bold" style="color: #999;">{chainIcons[l1.chain] || '?'}</span>
								{/if}
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-xs font-semibold" style="color: var(--text);">{l1.chain}</span>
									{#if l1.pool}
										<span class="text-xs" style="color: var(--text-faint);">via {l1.pool}</span>
									{/if}
								</div>
								<button
									onclick={() => copyAddress(l1.address)}
									class="font-mono text-xs break-all text-left mt-0.5"
									style="color: var(--text-secondary);"
								>
									{l1.address}
									{#if copiedAddr === l1.address}
										<span class="ml-1" style="color: #10b981;">&#10003;</span>
									{/if}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<div class="mx-auto max-w-7xl px-4 pt-20 pb-12">
	<div class="flex items-end justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold" style="color: var(--text);">Addresses</h1>
			<p class="text-sm mt-1" style="color: var(--text-muted);">
				{data.total.toLocaleString('en-US')} users · {data.totalL1.toLocaleString('en-US')} linked L1 addresses
			</p>
		</div>
	</div>

	<!-- Filters -->
	<div class="mb-6 flex flex-wrap items-center gap-3">
		<div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--app-border);">
			{#each ['linked', 'flagged', 'all'] as f}
				<button
					onclick={() => setFilter(f)}
					class="px-4 py-2 text-sm capitalize transition-colors"
					style={data.filter === f
						? 'background: var(--app-accent); color: white;'
						: 'background: var(--bg-card); color: var(--text-muted);'}
				>
					{f === 'linked' ? 'Linked' : f === 'flagged' ? 'Flagged' : 'All'}
				</button>
			{/each}
		</div>

		<div class="chain-select-wrap">
			<select
				onchange={(e) => setChain((e.target as HTMLSelectElement).value)}
				class="chain-select rounded-lg px-3 py-2 text-sm outline-none"
			>
				<option value="">All Chains</option>
				{#each getChains() as c}
					<option value={c} selected={data.chain === c}>{c}</option>
				{/each}
			</select>
			{#if data.chain && chainLogo(data.chain)}
				<img src={chainLogo(data.chain)} alt={data.chain} class="chain-select-icon" />
			{/if}
		</div>

		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search any thor/0x/bc1 address..."
			class="login-input flex-1 rounded-lg px-4 py-2 text-sm outline-none"
			onkeydown={(e) => { if (e.key === 'Enter') doSearch(); }}
		/>
		<button onclick={doSearch} class="rounded-lg px-3 py-2 text-sm font-medium text-white" style="background: var(--app-accent);">Search</button>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto rounded-xl" style="background: var(--bg-card); border: 1px solid var(--app-border);" data-win-title="Address Lookup">
		<table class="w-full text-left text-sm">
			<thead>
				<tr style="border-bottom: 1px solid var(--app-border);">
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Address</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Linked Chains</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Status</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);">Screened</th>
					<th class="px-4 py-3 font-medium" style="color: var(--text-muted);"></th>
				</tr>
			</thead>
			<tbody>
				{#each filteredUsers as user}
					<tr
						class="transition-colors"
						style="border-bottom: 1px solid var(--app-border-subtle); {user.flagged ? 'border-left: 2px solid #ef4444; background: rgba(239,68,68,0.03);' : ''}"
						onmouseenter={(e) => { e.currentTarget.style.background = user.flagged ? 'rgba(239,68,68,0.06)' : 'var(--bg-card-hover)'; }}
						onmouseleave={(e) => { e.currentTarget.style.background = user.flagged ? 'rgba(239,68,68,0.03)' : ''; }}
					>
						<td class="px-4 py-3">
							<button
								onclick={() => copyAddress(user.thorAddress)}
								class="font-mono text-sm transition-colors"
								style="color: var(--text);"
								title="Click to copy"
							>
								{truncate(user.thorAddress)}
								{#if copiedAddr === user.thorAddress}
									<span class="ml-1 text-xs" style="color: #10b981;">&#10003;</span>
								{/if}
							</button>
						</td>
						<td class="px-4 py-3">
							{#if user.l1Addresses.length > 0}
								<button
									onclick={() => selectedUser = user}
									class="flex items-center gap-1.5"
								>
									{#each getUniqueChains(user.l1Addresses) as chain}
										<span
											class="inline-flex items-center justify-center w-7 h-7 rounded-full transition-transform hover:scale-110"
											style={chainColor(chain)}
											title="{chain}: {user.l1Addresses.filter((l: any) => l.chain === chain).length} address(es)"
										>
											{#if chainLogo(chain)}
												<img src={chainLogo(chain)} alt={chain} class="w-4 h-4 rounded-full" />
											{:else}
												<span class="text-xs font-bold" style="color: #999;">{chainIcons[chain] || '?'}</span>
											{/if}
										</span>
									{/each}
									<span class="text-xs ml-1" style="color: var(--text-faint);">
										{user.l1Addresses.length}
									</span>
								</button>
							{:else}
								<span class="text-xs" style="color: var(--text-ghost);">—</span>
							{/if}
						</td>
						<td class="px-4 py-3">
							{#if user.flagged}
								<span class="inline-flex items-center gap-1" style="color: #ef4444;">
									<span class="inline-block h-2 w-2 animate-pulse rounded-full" style="background: #ef4444;"></span>
									Flagged
								</span>
							{:else}
								<span style="color: #10b981;">✓ Clean</span>
							{/if}
						</td>
						<td class="px-4 py-3" style="color: var(--text-muted);">
							{user.screenedAt
								? new Date(user.screenedAt).toLocaleDateString()
								: '—'}
						</td>
						<td class="px-4 py-3">
							{#if user.l1Addresses.length > 0}
								<button
									onclick={() => selectedUser = user}
									class="text-xs transition-colors"
									style="color: var(--app-accent);"
								>
									View
								</button>
							{:else}
								<span class="text-xs" style="color: var(--text-ghost);">—</span>
							{/if}
						</td>
					</tr>
				{/each}

				{#if filteredUsers.length === 0}
					<tr>
						<td colspan="5" class="px-4 py-12 text-center" style="color: var(--text-muted);">
							No addresses found.
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if data.total > data.perPage}
		<div class="mt-4 flex items-center justify-center gap-2">
			{#if data.page > 1}
				<a
					href="?filter={data.filter}&chain={data.chain}&page={data.page - 1}"
					class="rounded-lg px-3 py-1.5 text-sm transition-colors"
					style="border: 1px solid var(--app-border); color: var(--text-muted);"
				>
					Previous
				</a>
			{/if}
			<span class="text-sm" style="color: var(--text-muted);">
				Page {data.page} of {Math.ceil(data.total / data.perPage)}
			</span>
			{#if data.page * data.perPage < data.total}
				<a
					href="?filter={data.filter}&chain={data.chain}&page={data.page + 1}"
					class="rounded-lg px-3 py-1.5 text-sm transition-colors"
					style="border: 1px solid var(--app-border); color: var(--text-muted);"
				>
					Next
				</a>
			{/if}
		</div>
	{/if}
</div>

<style>
	.chain-select-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.chain-select {
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
		padding-left: 2rem;
	}
	.chain-select-icon {
		position: absolute;
		left: 8px;
		width: 16px;
		height: 16px;
		pointer-events: none;
		border-radius: 50%;
	}
	.login-input {
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
	}
	.login-input:focus {
		border-color: var(--app-accent);
	}
	.login-input::placeholder {
		color: var(--text-faint);
	}
</style>
