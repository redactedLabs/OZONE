<script lang="ts">
	import Toast from '$lib/components/Toast.svelte';
	import Clippy from '$lib/components/Clippy.svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { theme } from '$lib/stores/theme.svelte';
	import Ghost from '$lib/components/Ghost.svelte';

	type GlobeMarker = { location: [number, number]; size?: number; color?: string; label?: string; logo?: string };

	let { data } = $props();

	const isAdmin = $derived(!!data?.user);
	let toast = $state({ visible: false, message: '', variant: 'info' as const });
	let GlobeComponent: any = $state(null);
	let BlocksGlobeComponent: any = $state(null);
	let mounted = $state(false);
	// a phone: the Redacted globe is drawn smaller so it fits its card
	let narrow = $state(false);
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
	// the arcs of the Redacted theme's globe (a light world), in the brand's blue
	const globeArcsRedacted = $derived(globeArcs.map((a) => ({ ...a, color: '#1f8ff0' })));

	const globeMarkers: GlobeMarker[] = NODES.map(n => ({
		location: n.loc,
		size: 0.05,
		color: n.color,
		label: n.name,
	}));

	// The scanner in the Redacted hero: addresses fly in, verdicts fly out (an illustration, not live data).
	// Each pair shares its delay, so an address leaves as its own verdict.
	const SCANS = [
		{ chain: 'BTC', addr: 'bc1q…k7wz', flagged: false, note: '' },
		{ chain: 'ETH', addr: '0x7f3a…19c2', flagged: true, note: 'Received from a listed hack via THORChain' },
		{ chain: 'RUNE', addr: 'thor1…8m4q', flagged: false, note: '' },
	];
	const SCAN_SOURCES = ['OFAC', 'UK', 'EU', 'FBI', 'Tether', 'Circle', 'Hacks', 'Traces'];

	// the Redacted globe: every node in the brand's blue, labels as white chips with the coin's logo
	// (static/coins, from app.redacted.gg; GAIA is Cosmos: the ATOM logo)
	const COIN_LOGOS: Record<string, string> = { BTC: 'btc', ETH: 'eth', RUNE: 'rune', SOL: 'sol', USDT: 'usdt', AVAX: 'avax', DOGE: 'doge', GAIA: 'atom', TRX: 'trx' };
	const globeMarkersRedacted: GlobeMarker[] = globeMarkers.map((m) => ({
		...m,
		color: '#1f8ff0',
		logo: m.label && COIN_LOGOS[m.label] ? `/coins/${COIN_LOGOS[m.label]}.webp` : undefined
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
		/** Unique row key: THORChain reports some actions with the all-zero placeholder txID. */
		key?: string;
	};

	const placeholderTx = (id: string) => /^0+$/.test(id);
	const liveKey = (tx: LiveTx) =>
		placeholderTx(tx.txID) ? `${tx.type}|${tx.time}|${tx.fromFull}|${tx.toFull}|${tx.amount}|${tx.assetIn}` : tx.txID;

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
			// (deduplicated inside the batch too — several actions can share the placeholder txID)
			const newTxs = txData.filter((tx) => {
				if (!tx.txID) return false;
				const key = liveKey(tx);
				if (seenTxIDs.has(key)) return false;
				seenTxIDs.add(key);
				tx.key = key;
				return true;
			});

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
		const phone = window.matchMedia('(max-width: 639px)');
		const onPhone = () => (narrow = phone.matches);
		onPhone();
		phone.addEventListener('change', onPhone);

		pollLiveTxs();
		const txInterval = setInterval(pollLiveTxs, 8000);
		const dripInterval = setInterval(dripNext, 1200);

		import('$lib/motion-core').then((mod) => {
			GlobeComponent = mod.Globe;
			BlocksGlobeComponent = mod.BlocksGlobe;
			mounted = true;
		}).catch(() => {
			mounted = true;
		});

		return () => {
			phone.removeEventListener('change', onPhone);
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
	<title>Ozone — On-chain Compliance for THORChain & Rujira</title>
	<meta name="description" content="Free compliance infrastructure for THORChain & Rujira. Screen wallets against OFAC, EU sanctions, Tether frozen lists. Export transaction history for tax reporting. Proof of innocence certificates." />
	<meta property="og:title" content="Ozone — On-chain Compliance for THORChain & Rujira" />
	<meta property="og:description" content="Screen wallets, export tax history, get compliance certificates. OFAC, EU, Tether, hack databases. Free & open source." />
	<meta property="og:url" content="https://ozone.redacted.gg" />
	<meta name="twitter:title" content="Ozone — On-chain Compliance for THORChain & Rujira" />
	<meta name="twitter:description" content="Screen wallets, export tax history, get compliance certificates. Free & open source." />
	{@html `<script type="application/ld+json">${JSON.stringify({
		"@context": "https://schema.org",
		"@type": "WebApplication",
		"name": "Ozone",
		"description": "Free on-chain compliance infrastructure for THORChain & Rujira. Wallet screening, tax export, compliance certificates.",
		"url": "https://ozone.redacted.gg",
		"applicationCategory": "FinanceApplication",
		"operatingSystem": "Web",
		"offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
		"creator": { "@type": "Organization", "name": "Redacted", "url": "https://redacted.money" }
	})}</script>`}
</svelte:head>

<div class="relative min-h-screen overflow-hidden">
	<!-- Content -->
	<div class="page-shell relative z-10 mx-auto max-w-7xl px-4 pt-20 pb-16 sm:px-6">

	<!-- Hero and the numbers: the page head (a night panel in the Redacted theme) -->
	<div class="page-hero">
	<!-- Hero -->
	<div class="text-center mb-6 pt-4 sm:pt-8">
		<h1 class="hero-title text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-3"><span style="color: var(--hero-title);">Redacted</span><span style="color: var(--hero-slash);">\</span><span class="rd-grad" style="color: var(--hero-sub);">Ozone</span></h1>
		<p class="text-sm sm:text-base mb-4" style="color: var(--text-muted);">
			On-chain compliance infrastructure for THORChain & Rujira
		</p>
		<div class="flex items-center justify-center gap-3">
			<a href="/history" class="hero-cta-primary rounded-lg px-5 py-2 text-sm font-semibold text-white">Wallet Explorer</a>
			<a href="/certificate" class="hero-cta-secondary rounded-lg px-5 py-2 text-sm font-medium">Proof of Innocence</a>
		</div>
	</div>

	<!-- Redacted theme: the scanner, as redacted.gg's hero phone -->
	<div class="rd-only scan-stage" aria-hidden="true">
		<div class="scan-streams">
			{#each SCANS as s, i (s.addr)}
				<div class="scan-card scan-in" style="animation-delay: {i * -3}s;">
					<span class="scan-coin">{s.chain}</span>
					<span class="scan-card-text"><b>{s.chain === 'RUNE' ? 'THORChain' : s.chain === 'BTC' ? 'Bitcoin' : 'Ethereum'}</b><code>{s.addr}</code></span>
					<span class="scan-pill">unchecked</span>
				</div>
				<div class="scan-card scan-out" class:scan-flagged={s.flagged} style="animation-delay: {i * -3}s;">
					<span class="scan-coin">{s.chain}</span>
					<span class="scan-card-text"><b>{s.flagged ? 'Flagged' : 'Clear'}</b><small>{s.flagged ? s.note : `Checked against ${data.stats.sources} lists`}</small></span>
					<span class="scan-verdict">{s.flagged ? '!' : '✓'}</span>
				</div>
			{/each}
		</div>
		<div class="scan-device">
			<span class="rd-tile scan-tile"><Ghost /></span>
			<div class="scan-device-title">Screening</div>
			<div class="scan-sources">
				{#each SCAN_SOURCES as src, i (src)}<span style="animation-delay: {i * 0.35}s;">{src}</span>{/each}
			</div>
			<div class="scan-beam"></div>
		</div>
	</div>

	<!-- Line 1: Stats boxes (one meaning per number — see /methodology#numbers) -->
	<div class="relative z-20 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
		<a href="/flagged" class="dash-box stat-hover rounded-xl p-4 relative group block" style="text-decoration: none; color: inherit;">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #ef4444;">{data.stats.flaggedAddresses === null ? '—' : data.stats.flaggedAddresses.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Flagged Addresses · all chains</div>
			<div class="stat-tip">Every address in the signed snapshot at risk "high" or above, on any chain: listed (sanctions, law enforcement, hacks, freezes, …, incl. the same key on sibling chains), traced through THORChain from a listed address, or a monitored thor1 account linked to one. Each address counts once. The list shows how each one is flagged. Click for the list.</div>
		</a>
		<a href="/flagged?list=thor" class="dash-box stat-hover rounded-xl p-4 relative group block" style="text-decoration: none; color: inherit;">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #ef4444;">{data.stats.flaggedThorAddresses === null ? '—' : data.stats.flaggedThorAddresses.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Flagged THORChain (thor1) Addresses</div>
			<div class="stat-tip">The thor1 addresses among the flagged addresses: listed, traced through THORChain, or monitored accounts linked by their own signed actions to a listed L1 address. Click for the list.</div>
		</a>
		<a href="/banned" class="dash-box stat-hover rounded-xl p-4 relative group block" style="text-decoration: none; color: inherit;">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: #f59e0b;">{data.stats.listedAddresses.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Listed Addresses · all risks</div>
			{#if data.stats.newListedDay > 0}
				<div class="stat-inset">
					<span class="font-mono font-bold" style="color: #10b981;">+{compact(data.stats.newListedDay)}</span>
					<span class="today-label" style="color: var(--text-faint);">1d</span>
				</div>
			{/if}
			<div class="stat-tip">Distinct addresses currently on at least one of {data.stats.sources} lists: OFAC, UK and EU sanctions, FBI attributions, hack incidents, Tether and Circle freezes, hack clusters, exploiter and phishing lists, at any risk (medium-risk phishing entries are listed but not flagged). Delisted addresses are kept as history and no longer flag.</div>
		</a>
		<a href="/screening" class="dash-box stat-hover rounded-xl p-4 relative group block" style="text-decoration: none; color: inherit;">
			<div class="flex items-baseline gap-2">
				<div class="text-2xl sm:text-3xl font-bold font-mono" style="color: var(--stat-indigo);">{data.stats.monitoredThorAccounts.toLocaleString('en-US')}</div>
			</div>
			<div class="text-[10px] sm:text-xs mt-1" style="color: var(--text-muted);">Monitored thor1 Accounts · <span style="color: #ef4444;">{data.stats.monitoredAccountsFlagged.toLocaleString('en-US')} flagged</span></div>
			{#if data.stats.newAccountsDay > 0}
				<div class="stat-inset">
					<span class="font-mono font-bold" style="color: #10b981;">+{compact(data.stats.newAccountsDay)}</span>
					<span class="today-label" style="color: var(--text-faint);">1d</span>
				</div>
			{/if}
			<div class="stat-tip">thor1 accounts Ozone monitors (Rujira League, Midgard LPs, live transactions), screened directly and through their {data.stats.linkedL1.toLocaleString('en-US')} linked L1 addresses. "Flagged" counts those flagged themselves or linked to a listed L1 address (formerly "Flagged THORChain Users"; the old screener's 2 were fee collectors, both false positives).</div>
		</a>
	</div>
	</div>

	<!-- Line 2: Live TX + Globe -->
	{#snippet rdMarkerTooltip(ctx: any)}
		<div class="rd-marker pointer-events-none" style="opacity: {ctx.visibility};">
			{#if ctx.marker.logo}<img src={ctx.marker.logo} alt="" width="14" height="14" />{/if}{ctx.marker.label || ''}
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
				{#each liveTxs as tx, i (tx.key ?? (tx.txID || `tx-${i}`))}
					{@const typeColor = tx.type === 'STREAM' ? 'var(--sky)' : tx.type === 'SWAP' ? 'var(--blue)' : tx.type === 'ADD' ? 'var(--success-text)' : tx.type === 'WD' ? 'var(--warning-text)' : tx.type === 'SEND' ? 'var(--sky)' : tx.type === 'REFUND' ? 'var(--danger-text)' : 'var(--mute)'}
					<div class="tx-row px-3 py-1.5 text-[11px]" style="border-bottom: 1px solid var(--app-border-subtle);">
						<div class="flex items-center gap-1.5 w-full">
							<span class="shrink-0 w-14 text-center rounded px-1 py-0.5 text-[8px] font-bold" style="background: color-mix(in srgb, {typeColor} 12%, transparent); color: {typeColor};">{tx.type}</span>
							<span class="font-mono flex-1 min-w-0" style="color: var(--text-secondary);">
								<span class="tx-addr">{tx.from}</span>
								<span style="color: #334155; margin: 0 2px;">→</span>
								<span class="tx-addr">{tx.to}</span>
							</span>
							<span class="shrink-0 text-[9px] font-mono text-right whitespace-nowrap" style="color: var(--text-faint);">{#if tx.amount}<span style="color: var(--text);">{tx.amount}</span>&nbsp;{/if}{tx.assetIn}{#if tx.assetOut && tx.assetOut !== tx.assetIn}<span class="tx-out">&nbsp;→&nbsp;{tx.assetOut}</span>{/if}</span>
							<span class="shrink-0 w-7 text-right text-[9px] font-mono" style="color: var(--text-ghost);">{txAge(tx.time)}</span>
							{#if tx.txID && !placeholderTx(tx.txID)}
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
				<div class="rd-globe">
					<svelte:component
						this={GlobeComponent}
						class="h-full w-full"
						radius={narrow ? 2.5 : 3}
						pointCount={20000}
						landPointColor={'#29b4f2'}
						landBlending="normal"
						landOpacity={0.6}
						arcBlending="normal"
						arcThickness={0.03}
						arcHeadSize={0.065}
						arcOpacity={0.95}
						pointSize={0.04}
						fresnelConfig={{ color: '#e8eff5', rimColor: '#29b4f2', rimPower: 1.6, rimIntensity: 0.9 }}
						atmosphereConfig={{ color: '#29b4f2', scale: 1.12, power: 10, coefficient: 0.85, intensity: 0.9 }}
						markers={globeMarkersRedacted}
						markerTooltip={rdMarkerTooltip}
						autoRotate={true}
						lockedPolarAngle={false}
						arcs={globeArcsRedacted}
					/>
				</div>
			{:else}
				<div class="flex h-full items-center justify-center" style="min-height: 350px;">
					<div class="mx-auto h-16 w-16 animate-pulse rounded-full" style="background: rgba(99,102,241,0.15);"></div>
				</div>
			{/if}

			<!-- Bottom pill: the real-time follower (the counts are in the boxes above, once each) -->
			{#if data.stats.follower}
				<a href="/api/health" class="health-pill absolute bottom-3 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1.5 whitespace-nowrap" style="background: var(--globe-pill-bg); backdrop-filter: blur(12px); border: 1px solid var(--border); text-decoration: none;" title="The newest THORChain block Ozone's real-time follower has traced; amber when it is more than 15 minutes behind">
					<span class="inline-block h-2 w-2 rounded-full {data.stats.follower.live ? 'animate-pulse' : ''}" style="background: {data.stats.follower.live ? '#10b981' : '#f59e0b'};"></span>
					<span class="text-[10px]" style="color: var(--text-muted);">{data.stats.follower.live ? 'Tracing live' : 'Tracing stalled'}</span>
					<span class="text-[10px]" style="color: var(--text-ghost);">·</span>
					<span class="text-[10px] font-mono" style="color: var(--text-secondary);">THORChain block {data.stats.follower.height.toLocaleString('en-US')}</span>
				</a>
			{/if}
		</div>
	</div>

	<!-- Sync status bar -->
	<div class="dash-box rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3" data-win-title="Sync Status">
		<p class="text-xs sm:text-sm leading-relaxed" style="color: var(--text-secondary);">
			Addresses on every THORChain chain are screened against OFAC, UK and EU sanctions, FBI attributions, Tether and Circle freezes, hack and phishing lists — and traced through THORChain.
			<a href="/methodology" style="color: var(--app-accent); text-decoration: none;"> Methodology &#8599;</a>
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
					<span class="text-[10px] font-mono" style="color: #6366f1;">Free &middot; No auth required</span>
				</div>
				<h3 class="text-lg sm:text-xl font-bold mb-2" style="color: var(--text);">Ozone API</h3>
				<p class="text-xs sm:text-sm leading-relaxed mb-4" style="color: var(--text-muted);">
					Batch-screen any address on any THORChain chain. Every answer is signed and names its sources and the THORChain transactions behind a trace — or download the signed snapshot and screen locally.
				</p>
				<div class="flex flex-wrap gap-2">
					<a href="/api-docs" class="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all" style="background: var(--app-accent);">Documentation</a>
					<a href="/flagged" class="rounded-lg px-4 py-2 text-xs font-medium transition-all hero-cta-secondary">Flagged Lists</a>
				</div>
			</div>
			<div class="p-4 sm:p-5 flex items-center">
				<pre class="api-preview rounded-xl p-4 w-full text-[10px] sm:text-[11px] overflow-x-auto"><code style="color: var(--text-muted);">{@html `<span style="color: #10b981;">POST</span> <span style="color: var(--stat-indigo);">/api/v1/screen</span>\n<span style="color: var(--text-faint);">{"addresses":["19qs8FPx…yhE"]}</span>\n\n<span style="color: var(--text-faint);">{"status":</span><span style="color: #ef4444;">"flagged"</span><span style="color: var(--text-faint);">,"risk":</span><span style="color: #f59e0b;">"high"</span><span style="color: var(--text-faint);">,</span>\n <span style="color: var(--text-faint);">"reasons":[{"code":</span><span style="color: #f59e0b;">"TRACE_SWAP"</span><span style="color: var(--text-faint);">,</span>\n  <span style="color: var(--text-faint);">"text":"Received 1.21 BTC from</span>\n  <span style="color: var(--text-faint);">Bybit Exploiter 65 via THORChain…"}],</span>\n <span style="color: var(--text-faint);">"signature":{"alg":"ed25519",…}}</span>`}</code></pre>
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

{#if theme.current === 'win98'}
	<Clippy />
{/if}

<Toast
	message={toast.message}
	variant={toast.variant}
	visible={toast.visible}
	onclose={() => (toast.visible = false)}
/>

<style>
	/* ── Redacted hero: the scanner (redacted.gg's card streams, fly-in / fly-out) ── */
	.scan-stage {
		position: relative;
		height: 340px;
		margin: 28px 0 36px;
		display: grid;
		place-items: center;
	}
	.scan-streams {
		position: absolute;
		inset: 0;
		perspective: 1100px;
		pointer-events: none;
	}
	.scan-card {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 300px;
		margin: -36px 0 0 -150px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px;
		border-radius: 18px;
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid rgba(10, 17, 28, 0.06);
		box-shadow: 0 20px 40px -24px rgba(10, 17, 28, 0.35);
		text-align: left;
		will-change: transform, opacity;
	}
	.scan-in {
		animation: fly-in 9s linear infinite both;
	}
	.scan-out {
		animation: fly-out 9s linear infinite both;
		border: 1.5px solid transparent;
		background: linear-gradient(#fff, #fff) padding-box, var(--grad) border-box;
		box-shadow: 0 0 24px -4px rgba(41, 180, 242, 0.55), 0 20px 40px -24px rgba(10, 17, 28, 0.35);
	}
	.scan-out.scan-flagged {
		background: linear-gradient(#fff, #fff) padding-box, linear-gradient(160deg, #f2545b, #f5b13d) border-box;
		box-shadow: 0 0 24px -6px rgba(242, 84, 91, 0.55), 0 20px 40px -24px rgba(10, 17, 28, 0.35);
	}
	.scan-coin {
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 999px;
		background: #0a111c;
		color: #fff;
		font: 700 10.5px/1 var(--font-mono);
		letter-spacing: 0.02em;
	}
	.scan-card-text {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.scan-card-text b {
		font-size: 16px;
		font-weight: 600;
		color: #0a111c;
	}
	.scan-card-text code,
	.scan-card-text small {
		font-size: 12px;
		color: #6a7686;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.scan-pill {
		flex: none;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(10, 17, 28, 0.05);
		font-size: 10.5px;
		font-weight: 500;
		color: #6a7686;
	}
	.scan-verdict {
		flex: none;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 999px;
		background: var(--grad);
		color: #fff;
		font-size: 13px;
		font-weight: 700;
	}
	.scan-flagged .scan-verdict {
		background: #f2545b;
	}
	.scan-device {
		position: relative;
		z-index: 2;
		width: 248px;
		padding: 26px 22px 24px;
		overflow: hidden;
		border-radius: 30px;
		border: 1.5px solid transparent;
		background: linear-gradient(#fff, #fff) padding-box, var(--grad) border-box;
		box-shadow: 0 0 40px -8px rgba(41, 180, 242, 0.6), 0 30px 60px -30px rgba(10, 17, 28, 0.45);
		text-align: center;
	}
	.scan-tile {
		width: 64px;
		height: 64px;
		border-radius: 20px;
		box-shadow: 0 18px 40px -10px rgba(41, 180, 242, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.35);
	}
	.scan-device-title {
		margin-top: 14px;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: #0a111c;
	}
	.scan-sources {
		margin-top: 12px;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
	}
	.scan-sources span {
		padding: 3px 8px;
		border-radius: 999px;
		background: rgba(10, 17, 28, 0.04);
		font: 500 11px/1.4 var(--font-mono);
		color: #3c4757;
		animation: scan-tick 2.8s ease-in-out infinite both;
	}
	/* the band scans behind the device's content, not through the ghost */
	.scan-device > :not(.scan-beam) {
		position: relative;
		z-index: 1;
	}
	.scan-beam {
		position: absolute;
		z-index: 0;
		left: 0;
		right: 0;
		top: 0;
		height: 26px;
		background: linear-gradient(180deg, transparent, rgba(41, 180, 242, 0.22) 60%, rgba(41, 180, 242, 0.6) 100%);
		border-bottom: 1.5px solid #29b4f2;
		animation: scan-beam 2.8s cubic-bezier(0.45, 0, 0.55, 1) infinite;
		pointer-events: none;
	}
	@keyframes scan-beam {
		0% { transform: translateY(-30px); opacity: 0; }
		12% { opacity: 1; }
		88% { opacity: 1; }
		100% { transform: translateY(250px); opacity: 0; }
	}
	@keyframes scan-tick {
		0%, 70%, 100% { background: rgba(10, 17, 28, 0.04); color: #3c4757; }
		20%, 45% { background: rgba(59, 216, 207, 0.18); color: #0a111c; }
	}
	@keyframes fly-in {
		0% { transform: translate3d(-62vw, 0, 0) rotateY(28deg) scale(1); opacity: 0; filter: blur(0); }
		8% { opacity: 1; }
		62% { transform: translate3d(-24.8vw, 0, 0) rotateY(19.3deg) scale(0.76); opacity: 1; filter: blur(0); }
		100% { transform: translate3d(-2vw, 0, 0) rotateY(14deg) scale(0.62); opacity: 0; filter: blur(6px); }
	}
	@keyframes fly-out {
		0% { transform: translate3d(2vw, 0, 0) rotateY(-14deg) scale(0.62); opacity: 0; filter: blur(6px); }
		12% { opacity: 1; }
		32% { transform: translate3d(21.2vw, 0, 0) rotateY(-18.5deg) scale(0.74); filter: blur(0); }
		90% { opacity: 1; }
		100% { transform: translate3d(62vw, 0, 0) rotateY(-28deg) scale(1); opacity: 0; filter: blur(0); }
	}
	/* below 1024 px (phones, tablets) the flow runs top to bottom: one address at a time drops into
	   the scanner and leaves underneath as its verdict (each pair 3 s apart, as on desktop) */
	@media (max-width: 1023px) {
		.scan-stage {
			--card-w: min(300px, calc(100vw - 56px));
			height: 430px;
			margin: 16px 0 28px;
		}
		.scan-streams {
			perspective: none;
		}
		.scan-card {
			width: var(--card-w);
			margin-left: calc(var(--card-w) / -2);
		}
		.scan-in {
			animation-name: drop-in;
		}
		.scan-out {
			animation-name: drop-out;
		}
		.scan-device {
			width: 220px;
			padding: 18px 16px 16px;
		}
		.scan-tile {
			width: 52px;
			height: 52px;
			border-radius: 16px;
		}
		.scan-device-title {
			margin-top: 10px;
			font-size: 16px;
		}
	}
	@keyframes drop-in {
		0% { transform: translateY(-190px); opacity: 0; filter: blur(0); }
		4% { transform: translateY(-165px); opacity: 1; }
		20% { transform: translateY(-165px); opacity: 1; filter: blur(0); }
		31% { transform: translateY(-40px) scale(0.8); opacity: 0; filter: blur(4px); }
		100% { transform: translateY(-40px) scale(0.8); opacity: 0; }
	}
	@keyframes drop-out {
		0%, 30% { transform: translateY(40px) scale(0.8); opacity: 0; filter: blur(4px); }
		40% { transform: translateY(165px) scale(1); opacity: 1; filter: blur(0); }
		60% { transform: translateY(165px); opacity: 1; }
		66%, 100% { transform: translateY(185px); opacity: 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.scan-streams {
			display: none !important;
		}
		.scan-beam,
		.scan-sources span {
			animation: none;
		}
	}

	/* the Redacted globe's chain labels: white chips, as redacted.gg's pills */
	.rd-marker {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px 3px 4px;
		border-radius: 999px;
		background: #fff;
		color: #0a111c;
		font: 600 11px/1.4 var(--font-mono);
		letter-spacing: 0.02em;
		white-space: nowrap;
		box-shadow: inset 0 0 0 1px rgba(31, 143, 240, 0.25), 0 8px 20px -10px rgba(10, 17, 28, 0.35);
	}
	.rd-marker img {
		width: 14px;
		height: 14px;
		border-radius: 999px;
	}
	@media (max-width: 639px) {
		.rd-marker {
			gap: 4px;
			padding: 2px 7px 2px 3px;
			font-size: 10px;
		}
		.rd-marker img {
			width: 12px;
			height: 12px;
		}
	}
	/* the Redacted globe: its own box; on a phone the "Tracing live" pill sits under it, not over it */
	.rd-globe {
		position: relative;
		height: 320px;
	}
	@media (min-width: 768px) {
		.rd-globe {
			position: absolute;
			inset: 0;
			height: auto;
		}
	}
	@media (max-width: 767px) {
		:global(html.redacted) .health-pill {
			position: static;
			translate: none;
			width: fit-content;
			margin: 0 auto 16px;
		}
	}
	/* the live list: one line per row, the address shortened, the amount never on top of it */
	:global(html.redacted) .tx-row .font-mono.flex-1 {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@media (max-width: 480px) {
		/* on a phone: no recipient and no target asset, so the sender's (already shortened) address fits whole */
		:global(html.redacted) .tx-addr + span,
		:global(html.redacted) .tx-out {
			display: none;
		}
	}

	/* the globe canvas is transparent */
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
