<script lang="ts">
	import { onMount } from 'svelte';

	let address = $state('');
	let phase = $state<'idle' | 'scanning' | 'done'>('idle');
	let heroVisible = $state(false);

	onMount(() => { heroVisible = true; });
	let scanStep = $state(0);
	let l1Count = $state(0);
	let result = $state<any>(null);
	let certDate = $state('');
	let certId = $state('');
	let certUrl = $state('');

	const SCAN_STEPS = [
		{ label: 'Validating address', detail: 'Checksum and chain detection (THOR, BTC, ETH, BSC, BASE, AVAX, GAIA, LTC, BCH, DOGE, TRON, XRP, SOL)...' },
		{ label: 'Sanctions lists', detail: 'OFAC SDN, UK Sanctions List, EU consolidated list, on-chain sanctions oracle...' },
		{ label: 'Law-enforcement attributions', detail: 'FBI / IC3 DPRK laundering addresses...' },
		{ label: 'Stablecoin freezes', detail: 'Tether (ETH, TRON, AVAX) and Circle (ETH, BASE, AVAX) blacklists...' },
		{ label: 'Hack & exploit clusters', detail: 'Bybit cluster, labelled exploiters, curated attributions...' },
		{ label: 'Phishing lists', detail: 'ScamSniffer and phishing labels...' },
		{ label: 'THORChain flow tracing', detail: 'Value received from listed addresses through THORChain (up to 3 hops)...' },
		{ label: 'Same-key addresses', detail: 'TRON/EVM and BTC/BCH/LTC/DOGE key twins...' },
		{ label: 'Issuing signed certificate', detail: 'Signing the verdict with Ozone\'s key...' },
	];

	async function startScan() {
		if (!address.trim()) return;
		phase = 'scanning';
		scanStep = 0;
		result = null;
		l1Count = 0;
		const addr = address.trim();

		// One request: Ozone screens the address itself and signs the certificate.
		const request = fetch('/api/certificate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ address: addr })
		})
			.then(async (r) => ({ ok: r.ok, body: await r.json() }))
			.catch(() => ({ ok: false, body: { error: 'Network error' } }));

		for (let i = 0; i < SCAN_STEPS.length - 1; i++) {
			scanStep = i;
			await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
		}
		scanStep = SCAN_STEPS.length - 1;
		const { ok, body } = await request;
		if (!ok) {
			result = { error: body.error ?? 'Screening failed', flagged: false, matches: [] };
			certId = '';
			phase = 'done';
			return;
		}
		const verdict = body.verdict;
		result = {
			flagged: body.flagged,
			risk: verdict.risk,
			matches: verdict.reasons
				.filter((r: any) => !r.removedAt)
				.map((r: any) => ({ source: r.source, entityName: r.entity ?? r.code, reason: r.text, ref: r.ref, risk: r.risk })),
			history: verdict.reasons.filter((r: any) => r.removedAt),
			snapshot: verdict.snapshot,
			signed: !!body.certificate?.signature
		};
		certId = body.certId;
		certDate = body.issuedAt?.split('T')[0] || new Date().toISOString().split('T')[0];
		certUrl = `/certificate/${certId}`;
		await new Promise((r) => setTimeout(r, 400));
		phase = 'done';
	}

	function reset() {
		phase = 'idle';
		address = '';
		result = null;
		scanStep = 0;
	}

	function truncAddr(a: string): string {
		if (a.length <= 20) return a;
		return `${a.slice(0, 12)}...${a.slice(-8)}`;
	}
</script>

<svelte:head>
	<title>Proof of Innocence — THORChain Compliance Certificate | Ozone</title>
	<meta name="description" content="Screen any THORChain or Rujira address against OFAC, EU sanctions, Tether frozen, known hacks, and more. Get a verifiable compliance certificate with a permanent ID — shareable with auditors, regulators, or counterparties." />
	<meta property="og:title" content="Proof of Innocence — Compliance Certificate | Ozone" />
	<meta property="og:description" content="Verifiable compliance certificate for THORChain & Rujira. Screen against 7+ databases. Permanent & shareable." />
	<meta property="og:url" content="https://ozone.redacted.gg/certificate" />
	<meta name="twitter:title" content="Proof of Innocence — Ozone" />
	<meta name="twitter:description" content="Get a verifiable compliance certificate for any THORChain address. Free." />
</svelte:head>

<div class="mx-auto px-4 pt-20 pb-16" class:max-w-5xl={phase === 'idle'} class:max-w-3xl={phase !== 'idle'}>

	{#if phase === 'idle'}

		<!-- Hero -->
		<div class="hero-section text-center mb-12" class:hero-visible={heroVisible}>
			<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 hero-badge">
				<span class="relative flex h-2 w-2">
					<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style="background: #10b981;"></span>
					<span class="relative inline-flex rounded-full h-2 w-2" style="background: #10b981;"></span>
				</span>
				<span class="text-[10px] font-mono tracking-wider uppercase" style="color: var(--text-muted);">Verifiable &middot; Shareable &middot; Permanent</span>
			</div>

			<h1 class="hero-title text-4xl sm:text-5xl font-bold tracking-tight mb-4">
				<span class="hero-gradient">Proof of Innocence</span>
			</h1>

			<p class="text-base sm:text-lg max-w-2xl mx-auto mb-2" style="color: var(--text-muted);">
				Screen any THORChain address against 8 compliance databases. Get a verifiable certificate you can share with anyone.
			</p>
			<p class="text-sm max-w-xl mx-auto" style="color: var(--text-faint);">
				No account needed. Permanent record with shareable link.
			</p>
		</div>

		<!-- Input card -->
		<div class="cert-card rounded-2xl p-6 sm:p-8 max-w-xl mx-auto mb-16" data-win-title="Screen Address">
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={address}
					placeholder="thor1…, bc1…, 0x…, T…, r… — any THORChain chain"
					class="cert-input flex-1 rounded-xl px-4 py-3 text-sm font-mono"
					onkeydown={(e) => { if (e.key === 'Enter') startScan(); }}
				/>
				<button
					onclick={startScan}
					disabled={!address.trim()}
					class="rounded-xl px-6 py-3 text-sm font-semibold text-white disabled:opacity-30 transition-all"
					style="background: var(--app-accent);"
				>
					Screen
				</button>
			</div>
			<p class="text-[10px] mt-3 text-center" style="color: var(--text-faint);">
				Screens against OFAC, UK and EU sanctions, FBI attributions, Tether and Circle freezes, hack and phishing lists, plus THORChain flow tracing. <a href="/methodology" style="color: var(--app-accent);">Methodology</a>
			</p>
		</div>

		<!-- How it works — Architecture -->
		<div class="mb-16">
			<h2 class="text-lg font-bold mb-6 text-center" style="color: var(--text);">How it works</h2>
			<div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
				{#each [
					{ num: '01', title: 'Enter Address', desc: 'Paste any address on a THORChain chain. Its format and checksum decide the chain.' },
					{ num: '02', title: 'Screen', desc: 'Checked against every list Ozone ingests and against THORChain flow tracing — the same signed snapshot relayer nodes use.' },
					{ num: '03', title: 'Issue Certificate', desc: 'Ozone signs the verdict. If flagged, you see every reason with its source and evidence — and can appeal.' },
					{ num: '04', title: 'Share', desc: 'Every certificate gets a permanent link you can share with anyone — tax advisor, lawyer, counterparty, or regulator.' },
				] as step}
					<div class="cert-card rounded-xl p-5">
						<div class="text-2xl font-bold font-mono mb-3" style="color: #10b981; opacity: 0.5;">{step.num}</div>
						<div class="text-sm font-semibold mb-1" style="color: var(--text);">{step.title}</div>
						<p class="text-xs leading-relaxed" style="color: var(--text-muted);">{step.desc}</p>
					</div>
				{/each}
			</div>
		</div>

		<!-- What's in a certificate -->
		<div class="cert-card rounded-2xl p-6 sm:p-8 mb-16" data-win-title="Certificate Contents">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
				<div>
					<div class="text-[10px] font-mono uppercase tracking-wider mb-2" style="color: #10b981;">Certificate Contents</div>
					<h2 class="text-xl font-bold mb-4" style="color: var(--text);">What you get</h2>
					<div class="space-y-2.5 mb-5">
						{#each [
							'Unique certificate ID (OZ-XXXXXXXX)',
							'Address screened + issue date',
							'All 8 databases verified with status',
							'CLEAR or FLAGGED result with details',
							'Permanent shareable link',
						] as item}
							<div class="flex items-center gap-2">
								<span class="shrink-0 text-xs leading-none" style="color: #10b981;">&#10003;</span>
								<span class="text-xs leading-none" style="color: var(--text-muted);">{item}</span>
							</div>
						{/each}
					</div>
				</div>
				<div class="rounded-xl overflow-hidden" style="background: rgba(15,23,42,0.5); border: 1px solid var(--app-border-subtle);">
					<div class="p-1" style="background: linear-gradient(90deg, #10b981, #6366f1, #10b981);"></div>
					<div class="p-5">
						<div class="flex items-center justify-center gap-2 mb-3">
							<img src="/redacted-logo.svg" alt="Redacted" style="height: 14px; opacity: 0.5;" />
							<span class="text-[9px] font-mono" style="color: var(--text-faint);">REDACTED\OZONE</span>
						</div>
						<div class="text-center mb-4">
							<div class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 mb-2" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
								<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: #10b981;"></span>
								<span class="text-[9px] font-semibold" style="color: #10b981;">Proof of Innocence</span>
							</div>
							<div class="text-sm font-bold" style="color: var(--text);">Ozone Certificate</div>
						</div>
						<div class="rounded-lg p-3 mb-3" style="background: rgba(16,185,129,0.03); border: 1px solid rgba(16,185,129,0.1);">
							<div class="text-center">
								<div class="text-lg mb-1" style="color: #10b981;">&#10003;</div>
								<div class="text-[9px]" style="color: var(--text-muted);">thor1abc...xyz</div>
								<div class="text-[9px] font-semibold mt-0.5" style="color: #10b981;">No matches found</div>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-2">
							<div class="rounded-md p-2" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border-subtle);">
								<div class="text-[8px]" style="color: var(--text-faint);">Certificate ID</div>
								<div class="text-[9px] font-mono" style="color: var(--text);">OZ-A1B2C3D4</div>
							</div>
							<div class="rounded-md p-2" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border-subtle);">
								<div class="text-[8px]" style="color: var(--text-faint);">Sources</div>
								<div class="text-[9px] font-mono" style="color: var(--text);">8 verified</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Databases -->
		<div class="mb-16">
			<h2 class="text-lg font-bold mb-6 text-center" style="color: var(--text);">Databases screened</h2>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				{#each [
					{ name: 'OFAC SDN', org: 'US Treasury', color: '#ef4444' },
					{ name: 'UK Sanctions', org: 'FCDO', color: '#ef4444' },
					{ name: 'EU Sanctions', org: 'European Union', color: '#3b82f6' },
					{ name: 'FBI / IC3', org: 'DPRK attributions', color: '#dc2626' },
					{ name: 'Tether & Circle', org: 'Issuer freezes (on-chain)', color: '#10b981' },
					{ name: 'Hack clusters', org: 'Bybit, exploiters, curated', color: '#f59e0b' },
					{ name: 'ScamSniffer', org: 'Phishing / drainers', color: '#6366f1' },
					{ name: 'THORChain tracing', org: 'Flows from listed addresses', color: '#22d3ee' },
				] as db}
					<div class="cert-card rounded-xl p-4 text-center">
						<div class="text-xs font-semibold mb-0.5" style="color: var(--text);">{db.name}</div>
						<div class="text-[9px]" style="color: var(--text-faint);">{db.org}</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Use cases -->
		<div class="mb-16">
			<h2 class="text-lg font-bold mb-6 text-center" style="color: var(--text);">Who uses this?</h2>
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div class="cert-card rounded-xl p-5">
					<div class="flex items-center gap-2 mb-3">
						<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
						</div>
						<h3 class="text-sm font-semibold" style="color: var(--text);">DeFi Users</h3>
					</div>
					<p class="text-xs leading-relaxed" style="color: var(--text-muted);">Prove your address is clean before interacting with protocols, OTC desks, or counterparties that require compliance checks.</p>
				</div>
				<div class="cert-card rounded-xl p-5">
					<div class="flex items-center gap-2 mb-3">
						<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
						</div>
						<h3 class="text-sm font-semibold" style="color: var(--text);">Tax & Legal</h3>
					</div>
					<p class="text-xs leading-relaxed" style="color: var(--text-muted);">Share the certificate link with your tax advisor or lawyer as evidence that your wallet has no sanctions or compliance flags.</p>
				</div>
				<div class="cert-card rounded-xl p-5">
					<div class="flex items-center gap-2 mb-3">
						<div class="flex items-center justify-center w-8 h-8 rounded-lg" style="background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.2);">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
						</div>
						<h3 class="text-sm font-semibold" style="color: var(--text);">Projects & DAOs</h3>
					</div>
					<p class="text-xs leading-relaxed" style="color: var(--text-muted);">Require contributors or treasury signers to provide a Proof of Innocence certificate before interacting with project funds.</p>
				</div>
			</div>
		</div>

	{:else if phase === 'scanning'}
		<!-- Scanning Phase -->
		<div class="text-center mb-8">
			<h2 class="text-xl font-bold mb-1" style="color: var(--text);">Screening in progress</h2>
			<p class="text-xs font-mono" style="color: var(--text-muted);">{truncAddr(address)}</p>
		</div>

		<div class="cert-card rounded-2xl p-6 sm:p-8" data-win-title="Screening Progress">
			<div class="space-y-0">
				{#each SCAN_STEPS as step, i}
					<div class="flex items-center gap-3 py-3" style="border-bottom: 1px solid var(--app-border-subtle); opacity: {i <= scanStep ? 1 : 0.25}; transition: opacity 0.4s;">
						<div class="shrink-0 w-6 h-6 flex items-center justify-center">
							{#if i < scanStep}
								<span class="text-sm" style="color: #10b981;">&#10003;</span>
							{:else if i === scanStep}
								<span class="scan-spinner"></span>
							{:else}
								<span class="inline-block w-2 h-2 rounded-full" style="background: var(--app-border);"></span>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium" style="color: {i <= scanStep ? 'var(--text)' : 'var(--text-ghost)'};">{step.label}</div>
							{#if i === scanStep}
								<div class="text-[10px] mt-0.5" style="color: var(--text-muted);">{step.detail}</div>
							{/if}
						</div>
						{#if i < scanStep}
							<span class="text-[9px] font-mono" style="color: var(--text-faint);">checked</span>
						{/if}
					</div>
				{/each}
			</div>
			<div class="mt-4 h-1 rounded-full overflow-hidden" style="background: var(--app-border);">
				<div class="h-full rounded-full transition-all duration-500" style="background: var(--app-accent); width: {((scanStep + 1) / SCAN_STEPS.length) * 100}%;"></div>
			</div>
		</div>

	{:else if phase === 'done' && result}
		<!-- Certificate Phase -->
		<div class="text-center mb-6">
			<button onclick={reset} class="text-xs mb-4" style="color: var(--text-muted);">&#8592; Screen another address</button>
		</div>

		{#if result.error}
			<div class="cert-card rounded-2xl p-6 sm:p-8 text-center" data-win-title="Screening failed">
				<h2 class="text-xl font-bold mb-2" style="color: #f59e0b;">No verdict</h2>
				<p class="text-sm" style="color: var(--text-secondary);">{result.error}. No certificate was issued.</p>
			</div>
		{:else if result.flagged}
			<!-- FLAGGED -->
			<div class="cert-card rounded-2xl overflow-hidden" style="border-color: rgba(239,68,68,0.3);">
				<div class="p-1" style="background: linear-gradient(90deg, #ef4444, #dc2626);"></div>
				<div class="p-6 sm:p-8 text-center">
					<div class="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style="background: rgba(239,68,68,0.1); border: 2px solid rgba(239,68,68,0.3);">
						<span class="text-3xl" style="color: #ef4444;">&#10007;</span>
					</div>
					<h2 class="text-xl font-bold mb-1" style="color: #ef4444;">Address Flagged</h2>
					<p class="text-xs font-mono mb-4" style="color: var(--text-muted);">{address}</p>
					<p class="text-sm mb-6" style="color: var(--text-secondary);">
						Risk <strong>{result.risk}</strong> — {result.matches.length} {result.matches.length === 1 ? 'reason' : 'reasons'}. The certificate {certId} records this result.
						All evidence: <a href="/api/v1/address/{encodeURIComponent(address)}" target="_blank" rel="noopener" style="color: var(--app-accent);">listings and THORChain flows</a>.
						If you believe this is wrong, <a href="/submit?kind=appeal&address={encodeURIComponent(address)}" style="color: var(--app-accent);">file an appeal</a>.
					</p>
					<div class="space-y-2 text-left max-w-md mx-auto">
						{#each result.matches as match}
							<div class="rounded-xl p-3" style="background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15);">
								<div class="flex items-center gap-2">
									<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background: rgba(239,68,68,0.15); color: #ef4444;">{match.source}</span>
									<span class="text-xs" style="color: var(--text);">{match.entityName || 'Match found'}</span>
								</div>
								{#if match.reason}
									<div class="text-[10px] mt-1" style="color: var(--text-muted);">{match.reason}{#if match.ref}&nbsp;<a href={match.ref} target="_blank" rel="noopener" style="color: var(--app-accent);">source&nbsp;&#8599;</a>{/if}</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		{:else}
			<!-- CLEAN — Certificate -->
			<div class="cert-card cert-glow rounded-2xl overflow-hidden" id="certificate" data-win-title="Ozone Certificate">
				<div class="p-1" style="background: linear-gradient(90deg, #10b981, #6366f1, #10b981);"></div>
				<div class="p-6 sm:p-10">
					<!-- Header -->
					<div class="text-center mb-6">
						<div class="flex items-center justify-center gap-2 mb-3">
							<img src="/redacted-logo.svg" alt="Redacted" style="height: 18px; opacity: 0.7;" />
							<span class="text-[10px] font-mono" style="color: var(--text-faint);">REDACTED\OZONE</span>
						</div>
						<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
							<span class="inline-block h-2 w-2 rounded-full" style="background: #10b981;"></span>
							<span class="text-xs font-semibold" style="color: #10b981;">Proof of Innocence</span>
						</div>
						<h2 class="text-2xl sm:text-3xl font-bold tracking-tight" style="color: var(--text);">Ozone Certificate</h2>
					</div>

					<!-- Certificate Body -->
					<div class="rounded-xl p-5 mb-6" style="background: rgba(16,185,129,0.03); border: 1px solid rgba(16,185,129,0.1);">
						<div class="text-center mb-4">
							<div class="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3" style="background: rgba(16,185,129,0.1); border: 2px solid rgba(16,185,129,0.3);">
								<span class="text-2xl" style="color: #10b981;">&#10003;</span>
							</div>
							<div class="text-xs" style="color: var(--text-muted);">This certifies that the address</div>
							<div class="text-sm font-mono font-semibold mt-1 break-all" style="color: var(--text);">{address}</div>
						</div>

						<p class="text-xs text-center leading-relaxed" style="color: var(--text-secondary);">
							has been screened against every list and THORChain trace in Ozone snapshot v{result.snapshot?.version}
							and <span style="color: #10b981; font-weight: 600;">nothing at risk "high" or above was found</span> as of the date below.
							{#if result.matches.length}<br /><span style="color: var(--text-muted);">Lower-risk notes: {result.matches.map((m: any) => m.reason).join(' · ')}</span>{/if}
							{#if result.signed}<br /><span style="color: var(--text-faint);">Signed with Ozone's key — verify via /api/certificate?id={certId}.</span>{/if}
						</p>
					</div>

					<!-- Details Grid -->
					<div class="grid grid-cols-2 gap-3 mb-6">
						<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
							<div class="text-[10px]" style="color: var(--text-faint);">Certificate ID</div>
							<div class="text-xs font-mono mt-0.5" style="color: var(--text);">{certId}</div>
						</div>
						<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
							<div class="text-[10px]" style="color: var(--text-faint);">Issued</div>
							<div class="text-xs font-mono mt-0.5" style="color: var(--text);">{certDate}</div>
						</div>
						<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
							<div class="text-[10px]" style="color: var(--text-faint);">Snapshot</div>
							<div class="text-xs font-mono mt-0.5" style="color: var(--text);">v{result.snapshot?.version}</div>
						</div>
						<div class="rounded-lg p-3" style="background: rgba(255,255,255,0.02); border: 1px solid var(--app-border);">
							<div class="text-[10px]" style="color: var(--text-faint);">Result</div>
							<div class="text-xs font-semibold mt-0.5" style="color: #10b981;">CLEAR</div>
						</div>
					</div>

					<!-- Sources Checked -->
					<div class="mb-6">
						<div class="text-[10px] mb-2" style="color: var(--text-faint);">SOURCES VERIFIED</div>
						<div class="flex flex-wrap gap-1.5">
							{#each ['OFAC SDN', 'UK Sanctions', 'EU Sanctions', 'FBI attributions', 'Tether freezes', 'Circle blacklist', 'Hack clusters', 'Exploiter labels', 'ScamSniffer', 'THORChain tracing'] as src}
								<span class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px]" style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.15); color: #10b981;">
									&#10003; {src}
								</span>
							{/each}
						</div>
					</div>

					<!-- Actions -->
					<div class="flex items-center justify-center gap-3 mb-6">
						<a href={certUrl} class="rounded-lg px-4 py-2 text-xs font-medium text-white transition-all" style="background: var(--app-accent);">
							Permanent link
						</a>
						<button onclick={() => { navigator.clipboard.writeText(window.location.origin + certUrl); }} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
							Copy link
						</button>
						<button onclick={reset} class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
							Screen another
						</button>
					</div>

					<!-- Footer -->
					<div class="text-center pt-4" style="border-top: 1px solid var(--app-border);">
						<p class="text-[9px] leading-relaxed" style="color: var(--text-ghost);">
							This certificate is generated automatically by Redacted Ozone and represents a point-in-time compliance check.
							It does not constitute legal advice. Re-screen periodically for continued compliance.
						</p>
						<div class="mt-3 flex items-center justify-center gap-2">
							<img src="/redacted-logo.svg" alt="" style="height: 12px; opacity: 0.3;" />
							<span class="text-[9px] font-mono" style="color: var(--text-ghost);">ozone.redacted.gg</span>
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.cert-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(8px);
	}
	.cert-glow {
		box-shadow: 0 0 60px rgba(16, 185, 129, 0.06), 0 0 120px rgba(99, 102, 241, 0.04);
	}
	.cert-input {
		background: var(--bg);
		border: 1px solid var(--app-border);
		color: var(--text);
		outline: none;
	}
	.cert-input:focus { border-color: var(--app-accent); }
	.cert-input::placeholder { color: var(--text-faint); }
	.scan-spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid var(--app-border);
		border-top-color: var(--app-accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Hero animations */
	.hero-section {
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.6s ease, transform 0.6s ease;
	}
	.hero-section.hero-visible {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-title {
		color: var(--text);
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.6s ease 0.1s, transform 0.6s ease 0.1s;
	}
	.hero-visible .hero-title {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-badge {
		background: rgba(16,185,129,0.08);
		border: 1px solid rgba(16,185,129,0.15);
		opacity: 0;
		transform: translateY(8px);
		transition: opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s;
	}
	.hero-visible .hero-badge {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-gradient {
		background: linear-gradient(135deg, #10b981, #6366f1, #a78bfa);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	@keyframes ping {
		75%, 100% {
			transform: scale(2);
			opacity: 0;
		}
	}
	.animate-ping {
		animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
</style>
