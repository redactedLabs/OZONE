<script lang="ts">
	import Toast from '$lib/components/Toast.svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { theme } from '$lib/stores/theme.svelte';

	type GlobeMarker = { location: [number, number]; size?: number; color?: string; label?: string };

	let { data } = $props();

	const isAdmin = $derived(!!data?.user);
	let toast = $state({ visible: false, message: '', variant: 'info' as const });
	let GlobeComponent: any = $state(null);
	let BlocksGlobeComponent: any = $state(null);
	let GodRaysComponent: any = $state(null);
	let mounted = $state(false);
	// Sync state
	let syncState = $state({
		active: false,
		step: '' as '' | 'members' | 'addresses' | 'compliance' | 'done',
		membersTotal: 0,
		membersNew: 0,
		addressesProcessed: 0,
		addressesTotal: 0,
		currentAddress: '',
		l1Found: 0,
		complianceResult: null as any,
	});

	// Fixed locations like COBE CDN — pinned markers with labels + arcs between them
	const NODES: Array<{ name: string; fullName: string; loc: [number, number]; color: string }> = [
		{ name: 'BTC', fullName: 'Bitcoin', loc: [-15.78, -47.93], color: '#f7931a' },     // Brasilia
		{ name: 'ETH', fullName: 'Ethereum', loc: [51.51, -0.13], color: '#627eea' },       // London
		{ name: 'RUNE', fullName: 'THORChain', loc: [35.68, 139.65], color: '#2ecc71' },     // Tokyo
		{ name: 'SOL', fullName: 'Solana', loc: [19.43, -99.13], color: '#9945ff' },      // Mexico City
		{ name: 'USDT', fullName: 'Tether', loc: [1.35, 103.82], color: '#26a17b' },      // Singapore
		{ name: 'AVAX', fullName: 'Avalanche', loc: [-1.29, 36.82], color: '#e84142' },      // Nairobi
		{ name: 'DOGE', fullName: 'Dogecoin', loc: [-33.87, 151.21], color: '#c4a430' },    // Sydney
		{ name: 'GAIA', fullName: 'Cosmos', loc: [45.42, -75.69], color: '#6d75f2' },      // Ottawa
		{ name: 'TRX', fullName: 'TRON', loc: [25.20, 55.27], color: '#ff0013' },       // Dubai
	];

	// Generate persistent arcs between nodes (like CDN routes)
	function buildArcs() {
		const routes: Array<[number, number]> = [
			[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], // ring
			[0, 2], [1, 4], [3, 5], [2, 6], [0, 8], [7, 3], [8, 1],         // cross
		];
		return routes.map(([from, to], i) => ({
			from: NODES[from].loc,
			to: NODES[to].loc,
			color: '#6366f1',
			speed: 0.4 + (i % 3) * 0.2,
			transient: false,
			_key: `route-${i}`,
			onfinish: () => {},
		}));
	}

	let globeArcs = $state(buildArcs());

	const globeMarkers: GlobeMarker[] = NODES.map(n => ({
		location: n.loc,
		size: 0.05,
		color: n.color,
		label: n.name,
	}));

	type LiveTx = {
		type: string;
		from: string;
		to: string;
		fromFull: string;
		toFull: string;
		assetIn: string;
		assetOut: string;
		amount: string;
		time: string | null;
		txID: string;
	};

	let liveTxs = $state<LiveTx[]>([]);
	let seenTxIDs = new Set<string>();
	let txQueue: LiveTx[] = [];
	const MAX_VISIBLE = 30;

	function txAge(time: string | null): string {
		if (!time) return '';
		const diff = Math.floor((Date.now() - new Date(time).getTime()) / 1000);
		if (diff < 5) return 'now';
		if (diff < 60) return `${diff}s`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		return `${Math.floor(diff / 3600)}h`;
	}

	function dripNext() {
		if (txQueue.length === 0) return;
		const next = txQueue.shift()!;
		liveTxs = [next, ...liveTxs].slice(0, MAX_VISIBLE);
	}

	async function pollLiveTxs() {
		try {
			const res = await fetch('/api/globe');
			if (!res.ok) return;
			const text = await res.text();
			const txData: LiveTx[] = JSON.parse(text);
			if (!Array.isArray(txData)) return;

			// Filter to only new txs we haven't seen
			const newTxs = txData.filter(tx => tx.txID && !seenTxIDs.has(tx.txID));
			for (const tx of newTxs) {
				seenTxIDs.add(tx.txID);
			}

			// On first load, show them all at once
			if (liveTxs.length === 0 && newTxs.length > 0) {
				liveTxs = newTxs.slice(0, MAX_VISIBLE);
				return;
			}

			// Queue new txs to drip in one-by-one (newest first)
			txQueue.push(...newTxs.reverse());
		} catch { /* keep existing data */ }
	}

	onMount(() => {
		pollLiveTxs();
		const txInterval = setInterval(pollLiveTxs, 8000);
		const dripInterval = setInterval(dripNext, 1200);

		import('$lib/motion-core').then((mod) => {
			GlobeComponent = mod.Globe;
			BlocksGlobeComponent = mod.BlocksGlobe;
			GodRaysComponent = mod.GodRays;
			mounted = true;
		}).catch(() => {
			mounted = true;
		});

		return () => {
			clearInterval(txInterval);
			clearInterval(dripInterval);
		};
	});

	async function runFullSync() {
		syncState.active = true;

		// Step 1: Fetch all members
		syncState.step = 'members';
		try {
			const res = await fetch('/api/sync/members', { method: 'POST' });
			const result = await res.json();
			syncState.membersTotal = result.total || 0;
			syncState.membersNew = result.newUsers || 0;
			// Refresh stats
			await invalidateAll();
		} catch (e) {
			toast = { visible: true, message: `Members sync failed: ${e}`, variant: 'error' };
		}

		// Step 2: Fetch L1 addresses in batches (works within Vercel timeout)
		syncState.step = 'addresses';
		syncState.addressesTotal = syncState.membersTotal;
		let addressesDone = false;
		while (!addressesDone) {
			try {
				const res = await fetch('/api/sync/addresses?batch=50', { method: 'POST' });
				const d = await res.json();
				if (d.done) {
					addressesDone = true;
					syncState.addressesProcessed = syncState.addressesTotal;
					syncState.l1Found = d.totalL1 || 0;
				} else {
					syncState.addressesProcessed = syncState.addressesTotal - (d.remaining || 0);
					syncState.l1Found = d.totalL1 || 0;
				}
				await invalidateAll();
			} catch (e) {
				console.error('L1 batch error:', e);
				addressesDone = true; // Stop on error
			}
		}

		// Step 3: Compliance lists + screening
		syncState.step = 'compliance';
		try {
			const res = await fetch('/api/sync/compliance', { method: 'POST' });
			syncState.complianceResult = await res.json();
		} catch (e) {
			toast = { visible: true, message: `Compliance sync failed: ${e}`, variant: 'error' };
		}

		syncState.step = 'done';
		syncState.active = false;
		toast = { visible: true, message: 'Full sync complete!', variant: 'success' };
		await invalidateAll();
	}

	function compact(n: number): string {
		if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
		if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
		return n.toLocaleString('en-US');
	}

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return 'Never';
		const diff = Date.now() - new Date(dateStr).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function truncAddr(addr: string): string {
		if (addr.length <= 16) return addr;
		return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
	}
</script>

<svelte:head>
	<title>Ozone — On-chain Compliance by Redacted</title>
</svelte:head>

<!-- Page with GodRays bg -->
<div class="relative min-h-screen overflow-hidden">
	<!-- GodRays layer -->
	{#if mounted && GodRaysComponent}
		<div class="godrays-bg">
			<svelte:component
				this={GodRaysComponent}
				class="h-full w-full"
				color={'#6366f1'}
				backgroundColor={'#060610'}
				intensity={0.3}
				speed={0.4}
				anchorX={0.5}
				anchorY={0.0}
				lightSpread={2.0}
				rayLength={2.5}
				fadeDistance={0.5}
				noiseAmount={0.15}
			/>
		</div>
	{/if}

	<!-- Content -->
	<div class="relative z-10 mx-auto max-w-7xl px-4 pt-20 pb-16 sm:px-6">

	<!-- Hero -->
	<div class="text-center mb-6 pt-4 sm:pt-8">
		<h1 class="hero-title text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-3"><span style="color: var(--hero-title);">Redacted</span><span style="color: var(--hero-slash);">\</span><span style="color: var(--hero-sub);">Ozone</span></h1>
		<p class="text-sm sm:text-base mb-4" style="color: var(--text-muted);">
			On-chain compliance infrastructure for THORChain & Rujira
		</p>
		<div class="flex items-center justify-center gap-3">
			<a href="/certificate" class="hero-cta-primary rounded-lg px-5 py-2 text-sm font-semibold text-white">Proof of Innocence</a>
			<a href="/history" class="hero-cta-secondary rounded-lg px-5 py-2 text-sm font-medium">Wallet Explorer</a>
		</div>
	</div>

	<!-- Line 1: Stats boxes -->
	<div class="relative z-20 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
		<div class="dash-box stat-hover rounded-xl p-4 relative group">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: var(--stat-indigo);">{data.stats.totalUsers.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Monitored Wallets</div>
			{#if data.stats.newUsersDay > 0}
				<div class="stat-inset">
					<span class="font-mono font-bold" style="color: #10b981;">+{compact(data.stats.newUsersDay)}</span>
					<span class="today-label" style="color: var(--text-faint);">1d</span>
				</div>
			{/if}
			<div class="stat-tip">All THORChain & Rujira addresses actively monitored. Sourced from Midgard LPs, Rujira League, on-chain actions, and live WebSocket events.</div>
		</div>
		<div class="dash-box stat-hover rounded-xl p-4 relative group">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #10b981;">{data.stats.totalL1.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Linked L1 Addresses</div>
			{#if data.stats.newL1Day > 0}
				<div class="stat-inset">
					<span class="font-mono font-bold" style="color: #10b981;">+{compact(data.stats.newL1Day)}</span>
					<span class="today-label" style="color: var(--text-faint);">1d</span>
				</div>
			{/if}
			<div class="stat-tip">Discovered deposit addresses (BTC, ETH, DOGE, etc.) linked to THORChain wallets via Midgard pool participation. Used for cross-chain compliance screening.</div>
		</div>
		<div class="dash-box stat-hover rounded-xl p-4 relative group">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #ef4444;">{data.stats.flaggedUsers.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Blocked</div>
			{#if data.stats.newBlockedDay > 0}
				<div class="stat-inset">
					<span class="font-mono font-bold" style="color: #ef4444;">+{compact(data.stats.newBlockedDay)}</span>
					<span class="today-label" style="color: var(--text-faint);">1d</span>
				</div>
			{/if}
			<div class="stat-tip">Wallets with linked L1 addresses (BTC, ETH, etc.) matching sanctioned or blacklisted entities. These addresses are restricted from Rujira services.</div>
		</div>
		<div class="dash-box stat-hover rounded-xl p-4 relative group">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #f59e0b;">{data.stats.totalListEntries.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">AML Watchlist</div>
			{#if data.stats.newListEntriesDay > 0}
				<div class="stat-inset">
					<span class="font-mono font-bold" style="color: #10b981;">+{compact(data.stats.newListEntriesDay)}</span>
					<span class="today-label" style="color: var(--text-faint);">1d</span>
				</div>
			{/if}
			<div class="stat-tip">Total addresses across all compliance sources: OFAC SDN ({data.stats.ofacEntries}), EU Sanctions ({data.stats.euEntries}), Known Hacks ({data.stats.hackEntries}), Tether Frozen, ScamSniffer, and manual flags. Auto-synced every 30 min.</div>
		</div>
	</div>

	<!-- Line 2: Live TX + Globe -->
	{#snippet markerTooltip(ctx: any)}
		<div class="pointer-events-none relative rounded-sm px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider whitespace-nowrap"
			style="background: {ctx.marker.color || '#f1f5f9'}; color: #060610; opacity: {ctx.visibility};">
			{ctx.marker.label || ''}
			<span class="absolute top-[calc(100%-1px)] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[4px] border-x-transparent" style="border-top-color: {ctx.marker.color || '#f1f5f9'};"></span>
		</div>
	{/snippet}

	{#snippet win98MarkerTooltip(ctx: any)}
		<div class="win98-face-label pointer-events-none" style="opacity: {ctx.visibility};">
			<div class="win98-label-titlebar">{ctx.marker.label || ''}</div>
			<div class="win98-label-body">{NODES.find(n => n.name === ctx.marker.label)?.fullName || ''}</div>
		</div>
	{/snippet}

	<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
		<!-- Live TX feed (order-2 on mobile so globe shows first) -->
		<div class="dash-box rounded-xl overflow-hidden order-2 md:order-1" data-win-title="Live Transactions">
			<div class="px-4 py-2.5 flex items-center gap-2" style="border-bottom: 1px solid var(--app-border);">
				<span class="live-dot"></span>
				<span class="text-xs font-semibold" style="color: var(--text);">Live</span>
			</div>
			<div class="max-h-[400px] overflow-y-auto">
				{#each liveTxs as tx, i (tx.txID || `tx-${i}`)}
					{@const typeColor = tx.type === 'STREAM' ? '#a78bfa' : tx.type === 'SWAP' ? '#818cf8' : tx.type === 'ADD' ? '#10b981' : tx.type === 'WD' ? '#f59e0b' : tx.type === 'SEND' ? '#22d3ee' : tx.type === 'REFUND' ? '#ef4444' : '#64748b'}
					<div class="tx-row px-3 py-1.5 text-[11px]" style="border-bottom: 1px solid var(--app-border-subtle);">
						<div class="flex items-center gap-1.5 w-full">
							<span class="shrink-0 w-14 text-center rounded px-1 py-0.5 text-[8px] font-bold" style="background: {typeColor}15; color: {typeColor};">{tx.type}</span>
							<span class="font-mono flex-1 min-w-0" style="color: var(--text-secondary);">
								<span class="tx-addr">{tx.from}</span>
								<span style="color: #334155; margin: 0 2px;">→</span>
								<span class="tx-addr">{tx.to}</span>
							</span>
							<span class="shrink-0 text-[9px] font-mono text-right whitespace-nowrap" style="color: var(--text-faint);">{#if tx.amount}<span style="color: var(--text);">{tx.amount}</span>&nbsp;{/if}{tx.assetIn}{#if tx.assetOut && tx.assetOut !== tx.assetIn}&nbsp;→&nbsp;{tx.assetOut}{/if}</span>
							<span class="shrink-0 w-7 text-right text-[9px] font-mono" style="color: var(--text-ghost);">{txAge(tx.time)}</span>
							{#if tx.txID}
								<a href="https://runescan.io/tx/{tx.txID}" target="_blank" rel="noopener" class="shrink-0 tx-link" title="View on RuneScan">&#8599;</a>
							{/if}
						</div>
					</div>
				{/each}
				{#if liveTxs.length === 0}
					<div class="px-4 py-8 text-center text-xs" style="color: var(--text-faint);">
						<span class="live-dot mr-2"></span>
						Connecting to THORChain...
					</div>
				{/if}
			</div>
		</div>

		<!-- Globe / Win98 Cube -->
		<div class="dash-box rounded-2xl relative overflow-hidden globe-container order-1 md:order-2" style="min-height: 350px;" data-win-title="Global Network">
			{#if theme.current === 'win98'}
				{#if mounted && BlocksGlobeComponent}
					<svelte:component
						this={BlocksGlobeComponent}
						class="h-full w-full"
						radius={3}
						markers={globeMarkers}
						markerTooltip={win98MarkerTooltip}
						arcs={globeArcs}
					/>
				{:else}
					<div class="flex h-full items-center justify-center" style="min-height: 350px;">
						Loading...
					</div>
				{/if}
			{:else if mounted && GlobeComponent}
				<svelte:component
					this={GlobeComponent}
					class="h-full w-full"
					radius={3}
					pointCount={20000}
					landPointColor={'#1e1b4b'}
					pointSize={0.035}
					fresnelConfig={{ color: '#060610', rimColor: '#6366f1', rimPower: 5, rimIntensity: 2.0 }}
					atmosphereConfig={{ color: '#6366f1', scale: 1.12, power: 10, coefficient: 0.85, intensity: 1.8 }}
					markers={globeMarkers}
					{markerTooltip}
					autoRotate={true}
					lockedPolarAngle={false}
					arcs={globeArcs}
				/>
			{:else}
				<div class="flex h-full items-center justify-center" style="min-height: 350px;">
					<div class="mx-auto h-16 w-16 animate-pulse rounded-full" style="background: rgba(99,102,241,0.15);"></div>
				</div>
			{/if}

			<!-- Bottom pill -->
			<div class="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1.5" style="background: var(--globe-pill-bg); backdrop-filter: blur(12px); border: 1px solid var(--border);">
				<span class="inline-block h-2 w-2 rounded-full animate-pulse" style="background: #10b981;"></span>
				<span class="text-[10px] font-mono" style="color: #10b981;">{data.stats.totalL1.toLocaleString('en-US')} L1 linked</span>
				<span class="text-[10px]" style="color: var(--text-ghost);">·</span>
				<span class="text-[10px] font-mono" style="color: #ef4444;">{data.stats.flaggedUsers.toLocaleString('en-US')} blocked</span>
			</div>
		</div>
	</div>

	<!-- Sync status bar -->
	<div class="dash-box rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3" data-win-title="Sync Status">
		<p class="text-xs sm:text-sm leading-relaxed" style="color: var(--text-secondary);">
			Every address screened against OFAC, EU sanctions, known hacks, Tether frozen wallets, and 5,000+ flagged entities.
			<a href="https://docs.redacted.money/using-redacted/compliance" target="_blank" rel="noopener" style="color: var(--app-accent); text-decoration: none;"> Learn more &#8599;</a>
		</p>
		<div class="flex items-center gap-3 shrink-0">
			<div class="flex items-center gap-1.5">
				<span class="inline-block h-2 w-2 rounded-full animate-pulse" style="background: #10b981;"></span>
				<span class="text-[11px]" style="color: var(--text-muted);">Synced {timeAgo(data.stats.lastSync)}</span>
			</div>
			{#if isAdmin}
				<button onclick={runFullSync} disabled={syncState.active} class="sync-btn rounded-lg px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
					{syncState.active ? 'Syncing...' : 'Sync'}
				</button>
			{/if}
		</div>
	</div>

	<!-- PoI Feature -->
	<div class="dash-box rounded-xl overflow-hidden mb-3" data-win-title="Proof of Innocence">
		<div class="grid grid-cols-1 md:grid-cols-2">
			<div class="p-5 sm:p-6 flex flex-col justify-center">
				<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
					<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: #10b981;"></span>
					<span class="text-[10px] font-mono" style="color: #10b981;">Verifiable &middot; Shareable</span>
				</div>
				<h3 class="text-lg sm:text-xl font-bold mb-2" style="color: var(--text);">Proof of Innocence</h3>
				<p class="text-xs sm:text-sm leading-relaxed mb-4" style="color: var(--text-muted);">
					Screen any THORChain address against every compliance database and receive a verifiable certificate. Each certificate gets a permanent ID — shareable with counterparties, auditors, or regulators.
				</p>
				<a href="/certificate" class="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all w-fit" style="background: #10b981;">Get Certificate</a>
			</div>
			<div class="p-4 sm:p-5 flex items-center justify-center">
				<div class="w-full max-w-xs">
					<!-- Mini cert preview -->
					<div class="rounded-xl overflow-hidden" style="background: var(--bg-code); border: 1px solid var(--app-border-subtle);">
						<div class="h-1" style="background: linear-gradient(90deg, #10b981, var(--app-accent), #10b981);"></div>
						<div class="p-4 text-center">
							<div class="text-[9px] font-mono mb-2" style="color: var(--text-faint);">REDACTED\OZONE</div>
							<div class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 mb-3" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.15);">
								<span class="text-[10px]" style="color: #10b981;">&#10003; CLEAR</span>
							</div>
							<div class="text-[10px] font-mono mb-1" style="color: var(--text);">thor1abc...xyz</div>
							<div class="text-[9px]" style="color: var(--text-faint);">OZ-A7K2M9XP</div>
							<div class="flex flex-wrap justify-center gap-1 mt-3">
								{#each ['OFAC', 'EU', 'Tether', 'Hacks'] as s}
									<span class="text-[8px] px-1.5 py-0.5 rounded" style="background: rgba(16,185,129,0.08); color: #10b981;">&#10003; {s}</span>
								{/each}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Transaction History Feature (reversed layout) -->
	<div class="dash-box rounded-xl overflow-hidden mb-3" data-win-title="Transaction History">
		<div class="grid grid-cols-1 md:grid-cols-2">
			<div class="p-4 sm:p-5 flex items-center justify-center md:order-1 order-2">
				<div class="w-full max-w-xs">
					<!-- Mini report preview -->
					<div class="rounded-xl overflow-hidden" style="background: var(--bg-code); border: 1px solid var(--app-border-subtle);">
						<div class="px-3 py-2 flex items-center justify-between" style="border-bottom: 1px solid var(--app-border-subtle);">
							<span class="text-[9px] font-mono" style="color: var(--text-faint);">A8KM2X9P4R</span>
							<span class="text-[9px] px-1.5 py-0.5 rounded" style="background: rgba(34,211,238,0.1); color: #22d3ee;">47 txs</span>
						</div>
						{#each [
							{ type: 'Swap', color: 'var(--app-accent)', amt: '0.5 BTC', out: '8.2 ETH' },
							{ type: 'Add LP', color: '#10b981', amt: '1,000 USDC', out: 'USDC/RUNE' },
							{ type: 'Swap', color: 'var(--app-accent)', amt: '2.1 ETH', out: '142 SOL' },
							{ type: 'Withdraw', color: '#f59e0b', amt: '500 USDC', out: '--' },
						] as row}
							<div class="px-3 py-1.5 flex items-center gap-2 text-[9px]" style="border-bottom: 1px solid var(--app-border-subtle);">
								<span class="px-1 py-0.5 rounded text-[8px] font-bold" style="background: {row.color}15; color: {row.color};">{row.type}</span>
								<span class="font-mono" style="color: var(--text);">{row.amt}</span>
								<span style="color: var(--text-ghost);">→</span>
								<span class="font-mono" style="color: var(--text-faint);">{row.out}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
			<div class="p-5 sm:p-6 flex flex-col justify-center md:order-2 order-1">
				<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.2);">
					<span class="text-[10px] font-mono" style="color: #22d3ee;">Private &middot; Exportable</span>
				</div>
				<h3 class="text-lg sm:text-xl font-bold mb-2" style="color: var(--text);">Transaction History</h3>
				<p class="text-xs sm:text-sm leading-relaxed mb-4" style="color: var(--text-muted);">
					Pull your full THORChain history. Export as CSV for your tax consultant or share via anonymous link — your address stays private. Perfect for tax reporting and audit trails.
				</p>
				<a href="/history" class="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all w-fit" style="background: #22d3ee; color: #0f172a;">Generate Report</a>
			</div>
		</div>
	</div>

	<!-- API Teaser -->
	<div class="dash-box rounded-xl overflow-hidden mb-3" data-win-title="Ozone API">
		<div class="grid grid-cols-1 md:grid-cols-2">
			<div class="p-5 sm:p-6 flex flex-col justify-center">
				<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);">
					<span class="text-[10px] font-mono" style="color: var(--stat-indigo);">Free &middot; No auth required</span>
				</div>
				<h3 class="text-lg sm:text-xl font-bold mb-2" style="color: var(--text);">Ozone API</h3>
				<p class="text-xs sm:text-sm leading-relaxed mb-4" style="color: var(--text-muted);">
					One endpoint. Every sanctions list. Screen any address in real-time — zero auth, zero cost. Integrate compliance checks into your app in minutes.
				</p>
				<div class="flex flex-wrap gap-2">
					<a href="/api-docs" class="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all" style="background: var(--app-accent);">Documentation</a>
					<a href="/api/flagged" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium transition-all hero-cta-secondary">Download Flagged List</a>
				</div>
			</div>
			<div class="p-4 sm:p-5 flex items-center">
				<pre class="api-preview rounded-xl p-4 w-full text-[10px] sm:text-[11px] overflow-x-auto"><code style="color: var(--text-muted);">{@html `<span style="color: #10b981;">GET</span> <span style="color: var(--stat-indigo);">/api/screen?address=thor1...</span>\n\n<span style="color: var(--text-faint);">{"address":"thor1abc...xyz",</span>\n <span style="color: var(--text-faint);">"flagged":</span><span style="color: #ef4444;">true</span><span style="color: var(--text-faint);">,</span>\n <span style="color: var(--text-faint);">"matches":[{"source":</span><span style="color: #f59e0b;">"OFAC"</span><span style="color: var(--text-faint);">,</span>\n   <span style="color: var(--text-faint);">"entityName":</span><span style="color: #f59e0b;">"Lazarus Group"</span><span style="color: var(--text-faint);">}]}</span>`}</code></pre>
			</div>
		</div>
	</div>

	<!-- Open Source (reversed layout) -->
	<div class="dash-box rounded-xl overflow-hidden mb-3" data-win-title="Open Source">
		<div class="grid grid-cols-1 md:grid-cols-2">
			<div class="p-4 sm:p-5 flex items-center justify-center md:order-1 order-2">
				<div class="w-full max-w-xs">
					<!-- Fake GitHub-style PR -->
					<div class="rounded-xl overflow-hidden" style="background: var(--bg-code); border: 1px solid var(--app-border-subtle);">
						<div class="px-3 py-2 flex items-center gap-2" style="border-bottom: 1px solid var(--app-border-subtle);">
							<span class="inline-block w-3 h-3 rounded-full" style="background: #a855f7;"></span>
							<span class="text-[10px] font-semibold" style="color: var(--text);">OZONE</span>
						</div>
						{#each [
							{ title: 'feat: add Bybit Feb 2025 exploit addresses', label: 'HACK', color: '#f59e0b', time: '2d ago' },
							{ title: 'feat: sync TRON Tether frozen list', label: 'TETHER', color: '#26a17b', time: '5d ago' },
							{ title: 'feat: eth-labels 988 malicious addresses', label: 'ETH_LABELS', color: '#fb923c', time: '1w ago' },
						] as pr}
							<div class="px-3 py-2 flex items-start gap-2" style="border-bottom: 1px solid var(--app-border-subtle);">
								<span class="shrink-0 mt-0.5" style="color: #a855f7;">
									<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/></svg>
								</span>
								<div class="min-w-0 flex-1">
									<div class="text-[10px] leading-tight" style="color: var(--text);">{pr.title}</div>
									<div class="flex items-center gap-2 mt-1">
										<span class="text-[8px] px-1 py-0.5 rounded font-bold" style="background: {pr.color}15; color: {pr.color};">{pr.label}</span>
										<span class="text-[8px]" style="color: var(--text-faint);">{pr.time}</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
			<div class="p-5 sm:p-6 flex flex-col justify-center md:order-2 order-1">
				<div class="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 w-fit" style="background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.2);">
					<span class="text-[10px] font-mono" style="color: #a855f7;">Community-powered</span>
				</div>
				<h3 class="text-lg sm:text-xl font-bold mb-2" style="color: var(--text);">Open Source</h3>
				<p class="text-xs sm:text-sm leading-relaxed mb-4" style="color: var(--text-muted);">
					Every data source is public. Every screening rule is transparent. Submit flagged addresses, contribute new data sources, or open a PR.
				</p>
				<div class="flex flex-wrap gap-2">
					<a href="/open-source" class="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all" style="background: #a855f7;">Contribute</a>
					<a href="https://github.com/redactedLabs/OZONE" target="_blank" rel="noopener" class="rounded-lg px-4 py-2 text-xs font-medium transition-all hero-cta-secondary">GitHub</a>
				</div>
			</div>
		</div>
	</div>

</div>
</div>

<Toast
	message={toast.message}
	variant={toast.variant}
	visible={toast.visible}
	onclose={() => (toast.visible = false)}
/>

<style>
	.godrays-bg {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 100vh;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}
	/* GodRays canvas keeps its background, globe canvas is transparent */
	.globe-container :global(canvas) {
		background: transparent !important;
	}
	.sync-btn {
		background: #6366f1;
		box-shadow: 0 0 20px rgba(99, 102, 241, 0.25);
	}
	.sync-btn:hover:not(:disabled) {
		background: #818cf8;
		box-shadow: 0 0 30px rgba(99, 102, 241, 0.5);
	}
	.dash-box {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
	}
	/* Stat hover tooltip */
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
	/* Daily new-adds inset box — top-right corner */
	.stat-inset {
		position: absolute;
		top: 10px;
		right: 10px;
		padding: 4px 10px;
		border-radius: 10px;
		background: var(--card-bg);
		border: 1px solid var(--app-border-subtle);
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		white-space: nowrap;
	}
	.stat-inset .today-label {
		display: inline;
	}
	/* Live dot */
	.live-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #10b981;
		box-shadow: 0 0 6px #10b981;
		animation: live-pulse 2s ease-in-out infinite;
	}
	@keyframes live-pulse {
		0%, 100% { opacity: 1; box-shadow: 0 0 6px #10b981; }
		50% { opacity: 0.5; box-shadow: 0 0 12px #10b981; }
	}
	/* TX row slide in */
	@keyframes tx-slide {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.tx-row {
		animation: tx-slide 0.3s ease-out both;
	}
	.api-preview {
		background: var(--bg-code);
		border: 1px solid var(--app-border-subtle);
		line-height: 1.7;
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
	}
	.tx-addr {
		white-space: nowrap;
	}
	.tx-link {
		color: #475569;
		font-size: 10px;
		text-decoration: none;
		transition: color 0.15s;
	}
	.tx-link:hover {
		color: #818cf8;
	}
	/* On small screens, hide the "to" address to save space */
	@media (max-width: 480px) {
		.tx-addr + span + .tx-addr {
			display: none;
		}
	}
	.hero-cta-primary {
		background: #6366f1;
		box-shadow: 0 0 20px rgba(99, 102, 241, 0.25);
		transition: all 0.2s;
	}
	.hero-cta-primary:hover {
		background: #818cf8;
		box-shadow: 0 0 30px rgba(99, 102, 241, 0.4);
	}
	.hero-cta-secondary {
		color: var(--text-muted);
		border: 1px solid var(--app-border);
		background: var(--card-bg);
		transition: all 0.2s;
	}
	.hero-cta-secondary:hover {
		color: var(--text);
		border-color: var(--tooltip-border);
	}
	.hero-title {
		font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
		letter-spacing: -0.03em;
	}
	.red-dot {
		display: inline-block;
		height: 12px;
		width: 12px;
		border-radius: 50%;
		background: #ef4444;
		box-shadow: 0 0 12px #ef4444, 0 0 24px rgba(239, 68, 68, 0.5);
	}
</style>
