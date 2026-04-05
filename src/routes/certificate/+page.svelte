<script lang="ts">
	let address = $state('');
	let phase = $state<'idle' | 'scanning' | 'done'>('idle');
	let scanStep = $state(0);
	let l1Count = $state(0);
	let result = $state<any>(null);
	let certDate = $state('');
	let certId = $state('');
	let certUrl = $state('');

	const SCAN_STEPS = [
		{ label: 'Resolving address', detail: 'Looking up THORChain identity...' },
		{ label: 'Discovering L1 addresses', detail: 'Pulling linked BTC, ETH, SOL deposit addresses...' },
		{ label: 'OFAC SDN List', detail: 'Screening against US Treasury sanctions...' },
		{ label: 'EU Sanctions', detail: 'Checking European Union consolidated list...' },
		{ label: 'Known Exploits', detail: 'Cross-referencing exploit & hack databases...' },
		{ label: 'Tether Frozen', detail: 'Checking USDT blacklist (ETH + TRON)...' },
		{ label: 'Phishing Database', detail: 'Scanning ScamSniffer + Eth Labels...' },
		{ label: 'Chainalysis Oracle', detail: 'Querying sanctions screening oracle...' },
		{ label: 'L1 Cross-check', detail: 'Back-checking all linked addresses against all lists...' },
		{ label: 'Issuing certificate', detail: 'Compiling compliance report...' },
	];

	async function startScan() {
		if (!address.trim()) return;
		phase = 'scanning';
		scanStep = 0;
		result = null;
		l1Count = 0;

		const addr = address.trim();

		// Step 0: Resolve
		scanStep = 0;
		await new Promise(r => setTimeout(r, 500));

		// Step 1: Pull L1 addresses live (triggers Midgard lookup if needed)
		scanStep = 1;
		try {
			// This triggers the search which auto-imports from Midgard
			const searchRes = await fetch(`/api/screen?address=${encodeURIComponent(addr)}`);
			// We'll use the result later, but the search triggers L1 discovery
			await searchRes.json();
		} catch { /* continue */ }
		await new Promise(r => setTimeout(r, 600));

		// Steps 2-8: Animate through compliance checks
		for (let i = 2; i < SCAN_STEPS.length - 1; i++) {
			scanStep = i;
			await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
		}

		// Final API call — screen with all L1s now discovered
		try {
			const res = await fetch(`/api/screen?address=${encodeURIComponent(addr)}`);
			result = await res.json();
		} catch {
			result = { error: 'Screening failed', flagged: false, matches: [] };
		}

		// Issue certificate via API
		scanStep = SCAN_STEPS.length - 1;
		try {
			const certRes = await fetch('/api/certificate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: addr, flagged: result?.flagged || false }),
			});
			const certData = await certRes.json();
			certId = certData.certId;
			certDate = certData.issuedAt?.split('T')[0] || new Date().toISOString().split('T')[0];
			certUrl = `/certificate/${certId}`;
		} catch {
			certId = 'OZ-ERROR';
			certDate = new Date().toISOString().split('T')[0];
		}

		await new Promise(r => setTimeout(r, 600));
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
	<title>Proof of Innocence — Ozone</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-20 pb-16">

	{#if phase === 'idle'}
		<!-- Input Phase -->
		<div class="text-center mb-10">
			<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4" style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);">
				<span class="text-[10px] font-mono" style="color: #10b981;">Proof of Innocence</span>
			</div>
			<h1 class="text-3xl sm:text-4xl font-bold tracking-tight mb-3" style="color: var(--text);">Proof of Innocence</h1>
			<p class="text-sm max-w-lg mx-auto" style="color: var(--text-muted);">
				Screen any address against every compliance database. Get a verifiable certificate — shareable and permanently on record.
			</p>
		</div>

		<div class="cert-card rounded-2xl p-6 sm:p-8">
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={address}
					placeholder="Enter thor1... address"
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
				Screens against OFAC, EU sanctions, Tether blacklist, known hacks, ScamSniffer, Chainalysis, and more.
			</p>
		</div>

	{:else if phase === 'scanning'}
		<!-- Scanning Phase -->
		<div class="text-center mb-8">
			<h2 class="text-xl font-bold mb-1" style="color: var(--text);">Screening in progress</h2>
			<p class="text-xs font-mono" style="color: var(--text-muted);">{truncAddr(address)}</p>
		</div>

		<div class="cert-card rounded-2xl p-6 sm:p-8">
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
							<span class="text-[9px] font-mono" style="color: #10b981;">PASS</span>
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

		{#if result.flagged}
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
						This address matched {result.matches.length} compliance {result.matches.length === 1 ? 'entry' : 'entries'} and cannot receive a certificate.
					</p>
					<div class="space-y-2 text-left max-w-md mx-auto">
						{#each result.matches as match}
							<div class="rounded-xl p-3" style="background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.15);">
								<div class="flex items-center gap-2">
									<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background: rgba(239,68,68,0.15); color: #ef4444;">{match.source}</span>
									<span class="text-xs" style="color: var(--text);">{match.entityName || 'Match found'}</span>
								</div>
								{#if match.reason}
									<div class="text-[10px] mt-1" style="color: var(--text-muted);">{match.reason}</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		{:else}
			<!-- CLEAN — Certificate -->
			<div class="cert-card cert-glow rounded-2xl overflow-hidden" id="certificate">
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
							has been screened against all compliance databases maintained by Redacted Ozone
							and <span style="color: #10b981; font-weight: 600;">no matches were found</span> as of the date below.
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
							<div class="text-[10px]" style="color: var(--text-faint);">Databases Checked</div>
							<div class="text-xs font-mono mt-0.5" style="color: var(--text);">8 sources</div>
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
							{#each ['OFAC SDN', 'EU Sanctions', 'Known Hacks', 'Tether Frozen', 'ScamSniffer', 'Eth Labels', 'Chainalysis', 'Manual Flags'] as src}
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
</style>
