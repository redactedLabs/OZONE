<script lang="ts">
	import { onMount } from 'svelte';

	let heroVisible = $state(false);

	onMount(() => {
		heroVisible = true;
	});

	const dataSources = [
		{ name: 'OFAC SDN List', org: 'US Treasury', url: 'https://sanctionslist.ofac.treas.gov/', desc: 'Specially Designated Nationals and Blocked Persons', type: 'Government' },
		{ name: 'EU Sanctions', org: 'European Union', url: 'https://www.eeas.europa.eu/eeas/european-union-sanctions_en', desc: 'EU Consolidated Financial Sanctions List', type: 'Government' },
		{ name: 'Tether Frozen', org: 'Tether / On-chain', url: 'https://etherscan.io/address/0xdac17f958d2ee523a2206206994597c13d831ec7', desc: 'USDT blacklisted addresses on ETH + TRON (on-chain events)', type: 'On-chain' },
		{ name: 'ScamSniffer', org: 'ScamSniffer', url: 'https://github.com/scamsniffer', desc: 'Phishing and scam address database', type: 'Community' },
		{ name: 'Eth Labels', org: 'dawsbot', url: 'https://github.com/dawsbot/eth-labels', desc: '170k+ labeled EVM addresses — exploits, heists, phishing', type: 'Community' },
		{ name: 'Chainalysis', org: 'Chainalysis', url: 'https://www.chainalysis.com/', desc: 'Sanctions screening oracle API', type: 'Commercial' },
		{ name: 'Known Hacks', org: 'Redacted Team', url: '#', desc: 'Curated list: Bybit, Ronin, Nomad, Harmony, WazirX, KuCoin', type: 'Curated' },
		{ name: 'Midgard', org: 'THORChain / Liquify', url: 'https://gateway.liquify.com/chain/thorchain_midgard/v2/doc', desc: 'THORChain indexer — user discovery and L1 address mapping', type: 'Infrastructure' },
	];

	const typeColors: Record<string, string> = {
		Government: 'color: #ef4444;',
		'On-chain': 'color: #10b981;',
		Community: 'color: #6366f1;',
		Commercial: 'color: #f59e0b;',
		Curated: 'color: #a855f7;',
		Infrastructure: 'color: #3b82f6;',
	};

	const submissionSteps = [
		{ num: '01', title: 'Open an Issue', desc: 'Click "Report Address" to open a pre-filled GitHub Issue with all the fields we need.' },
		{ num: '02', title: 'Provide Evidence', desc: 'Include the wallet address, chain, incident details, and links to transactions or reports.' },
		{ num: '03', title: 'Team Reviews', desc: 'Our compliance team verifies the submission against on-chain data and public sources.' },
		{ num: '04', title: 'Added to Screening', desc: 'Verified addresses are added to the compliance database and screened across all Rujira users.' },
	];
</script>

<svelte:head>
	<title>Open Source — Ozone</title>
	<meta name="description" content="Ozone is the open-source compliance layer for decentralized finance. Report sanctioned or hacked wallets and help shape a safer DeFi ecosystem." />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 pt-20 pb-16">

	<!-- Hero -->
	<div class="text-center mb-16" class:hero-visible={heroVisible}>
		<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 hero-badge">
			<span class="relative flex h-2 w-2">
				<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style="background: #10b981;"></span>
				<span class="relative inline-flex rounded-full h-2 w-2" style="background: #10b981;"></span>
			</span>
			<span class="text-[10px] font-mono tracking-wider uppercase" style="color: var(--text-muted);">Open source &middot; Community powered</span>
		</div>

		<h1 class="hero-title text-4xl sm:text-5xl font-bold tracking-tight mb-4">
			Shape a <span class="hero-gradient">safer future</span>
		</h1>

		<p class="text-base sm:text-lg max-w-2xl mx-auto mb-2" style="color: var(--text-muted);">
			Ozone is the compliance layer for decentralized finance.
		</p>
		<p class="text-sm max-w-xl mx-auto" style="color: var(--text-faint);">
			Transparent screening. Open data. Community-driven protection for THORChain & Rujira.
		</p>
	</div>

	<!-- Report Address CTA -->
	<div class="report-card rounded-2xl p-8 sm:p-10 mb-16 relative overflow-hidden">
		<div class="report-glow"></div>
		<div class="relative z-10">
			<div class="flex items-center gap-3 mb-2">
				<div class="flex items-center justify-center w-10 h-10 rounded-xl" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2);">
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
				</div>
				<h2 class="text-xl sm:text-2xl font-bold" style="color: var(--text);">Report a Wallet</h2>
			</div>
			<p class="text-sm leading-relaxed mb-6 max-w-xl" style="color: var(--text-muted);">
				Know of a hacked, sanctioned, or malicious wallet? Help protect the ecosystem by submitting it for review. Every verified report strengthens screening for all Rujira users.
			</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
				<div class="info-chip">
					<span class="info-chip-label">Required</span>
					<span class="info-chip-text">Wallet address &middot; Chain &middot; Category</span>
				</div>
				<div class="info-chip">
					<span class="info-chip-label">Evidence</span>
					<span class="info-chip-text">TX hashes &middot; Articles &middot; Reports</span>
				</div>
			</div>

			<div class="flex flex-wrap gap-3">
				<a href="https://github.com/redactedLabs/OZONE/issues/new?template=report-address.yml" target="_blank" rel="noopener" class="report-btn-primary">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
					Report Address
				</a>
				<a href="https://github.com/redactedLabs/OZONE" target="_blank" rel="noopener" class="report-btn-secondary">
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
					View on GitHub
				</a>
			</div>
		</div>
	</div>

	<!-- How Submissions Work -->
	<h2 class="text-lg font-bold mb-6" style="color: var(--text);">How submissions work</h2>
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-16">
		{#each submissionSteps as step}
			<div class="oss-card rounded-xl p-5 relative">
				<div class="text-2xl font-bold font-mono mb-3" style="color: var(--app-accent); opacity: 0.5;">{step.num}</div>
				<div class="text-sm font-semibold mb-1" style="color: var(--text);">{step.title}</div>
				<p class="text-xs leading-relaxed" style="color: var(--text-muted);">{step.desc}</p>
			</div>
		{/each}
	</div>

	<!-- Data Sources -->
	<h2 class="text-lg font-bold mb-2" style="color: var(--text);">Data Sources</h2>
	<p class="text-sm mb-6" style="color: var(--text-muted);">
		Every address screened by Ozone is checked against these sources. Government sanctions lists, on-chain blacklists, and community-curated databases — covering 5,000+ flagged entities.
	</p>

	<div class="space-y-3 mb-16">
		{#each dataSources as src}
			<a href={src.url} target="_blank" rel="noopener" class="oss-card rounded-xl p-4 flex items-start gap-4 group transition-all" style="text-decoration: none;">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 mb-1">
						<span class="text-sm font-semibold" style="color: var(--text);">{src.name}</span>
						<span class="text-[10px] font-mono" style="{typeColors[src.type] || ''}">{src.type}</span>
					</div>
					<p class="text-xs" style="color: var(--text-muted);">{src.desc}</p>
					<p class="text-[10px] mt-1" style="color: var(--text-faint);">{src.org}</p>
				</div>
				<span class="shrink-0 text-xs transition-transform group-hover:translate-x-0.5" style="color: var(--text-ghost);">&#8599;</span>
			</a>
		{/each}
	</div>

	<!-- How it works -->
	<h2 class="text-lg font-bold mb-4" style="color: var(--text);">How screening works</h2>
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-16">
		{#each [
			{ step: '01', title: 'Ingest', desc: 'Sanctions lists, hack databases, and on-chain blacklists are synced automatically every 30 minutes.' },
			{ step: '02', title: 'Map', desc: 'THORChain addresses are linked to their L1 deposit addresses (BTC, ETH, SOL, etc.) via Midgard.' },
			{ step: '03', title: 'Screen', desc: 'Every linked address is checked against all compliance sources. Matches trigger a flag.' },
		] as item}
			<div class="oss-card rounded-xl p-5">
				<div class="text-2xl font-bold font-mono mb-2" style="color: var(--app-accent);">{item.step}</div>
				<div class="text-sm font-semibold mb-1" style="color: var(--text);">{item.title}</div>
				<p class="text-xs leading-relaxed" style="color: var(--text-muted);">{item.desc}</p>
			</div>
		{/each}
	</div>

	<!-- Contribute -->
	<div class="oss-card rounded-2xl p-6 sm:p-8 mb-10">
		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
			<div>
				<h2 class="text-lg font-bold mb-2" style="color: var(--text);">Contribute</h2>
				<p class="text-sm leading-relaxed mb-4" style="color: var(--text-muted);">
					Ozone is fully open source. The codebase, data sources, and screening logic are transparent and auditable. Contributions strengthen the entire ecosystem.
				</p>
				<div class="flex flex-wrap gap-2">
					<a href="https://github.com/redactedLabs/OZONE" target="_blank" rel="noopener" class="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all" style="background: var(--app-accent);">
						OZONE — Frontend & API
					</a>
					<a href="https://github.com/redactedLabs/OZONE-WORKER" target="_blank" rel="noopener" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">
						OZONE-WORKER — Data sync
					</a>
				</div>
			</div>
			<div>
				<h3 class="text-sm font-semibold mb-3" style="color: var(--text);">Ways to contribute</h3>
				<ul class="space-y-2">
					{#each [
						'Report flagged addresses via GitHub Issues',
						'Submit new data source integrations',
						'Improve chain address detection',
						'Add support for new chains & protocols',
						'Report false positives for review',
					] as item}
						<li class="flex items-start gap-2 text-xs" style="color: var(--text-secondary);">
							<span style="color: #10b981;" class="shrink-0 mt-0.5">+</span>
							{item}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</div>

	<!-- Disclaimer -->
	<div class="oss-card rounded-xl p-5 text-center">
		<p class="text-xs leading-relaxed" style="color: var(--text-muted);">
			Ozone is provided as-is for informational purposes. It aggregates public data and does not constitute legal advice. False positives and negatives are possible — always verify critical compliance decisions independently. If you believe an address is incorrectly flagged, please <a href="https://github.com/redactedLabs/OZONE/issues" target="_blank" rel="noopener" style="color: var(--app-accent); text-decoration: underline;">open an issue</a>.
		</p>
	</div>
</div>

<style>
	.oss-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
	}
	.oss-card:hover {
		border-color: var(--app-accent);
	}

	/* Hero animations */
	.hero-title {
		color: var(--text);
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.6s ease, transform 0.6s ease;
	}
	.hero-visible .hero-title {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-badge {
		background: rgba(99,102,241,0.08);
		border: 1px solid rgba(99,102,241,0.15);
		opacity: 0;
		transform: translateY(8px);
		transition: opacity 0.5s ease 0.1s, transform 0.5s ease 0.1s;
	}
	.hero-visible .hero-badge {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-gradient {
		background: linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	/* Report card */
	.report-card {
		background: var(--card-bg);
		border: 1px solid rgba(239,68,68,0.15);
		backdrop-filter: blur(4px);
	}
	.report-card:hover {
		border-color: rgba(239,68,68,0.3);
	}
	.report-glow {
		position: absolute;
		top: -50%;
		right: -20%;
		width: 300px;
		height: 300px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(239,68,68,0.06) 0%, transparent 70%);
		pointer-events: none;
	}

	/* Info chips */
	.info-chip {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 8px;
		background: rgba(99,102,241,0.05);
		border: 1px solid rgba(99,102,241,0.1);
	}
	.info-chip-label {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--app-accent);
		white-space: nowrap;
	}
	.info-chip-text {
		font-size: 11px;
		color: var(--text-muted);
	}

	/* Buttons */
	.report-btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 20px;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 600;
		color: white;
		background: linear-gradient(135deg, #ef4444, #dc2626);
		transition: all 0.2s ease;
		text-decoration: none;
	}
	.report-btn-primary:hover {
		filter: brightness(1.1);
		transform: translateY(-1px);
	}
	.report-btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 20px;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		border: 1px solid var(--card-border);
		transition: all 0.2s ease;
		text-decoration: none;
	}
	.report-btn-secondary:hover {
		border-color: var(--app-accent);
		color: var(--text);
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
