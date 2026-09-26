<script lang="ts">
	import { onMount } from 'svelte';

	let { data } = $props();
	let heroVisible = $state(false);
	onMount(() => {
		heroVisible = true;
	});

	const kindColors: Record<string, string> = {
		sanctions: '#ef4444',
		law_enforcement: '#dc2626',
		stablecoin: '#10b981',
		community: '#6366f1',
		curated: '#a855f7',
		derived: '#22d3ee',
		manual: '#f59e0b'
	};

	const risks = [
		{ level: 'severe', color: '#ef4444', what: 'Official listing: OFAC, UK, EU sanctions, the on-chain oracle mirror of OFAC, FBI attributions of DPRK laundering addresses.' },
		{ level: 'high', color: '#f97316', what: 'Hack and exploiter addresses, stablecoin issuer freezes, maintainer flags; addresses that received ≥ $1,000 directly from a listed address through THORChain (hop 1); the first two layers of an attributed hack cluster.' },
		{ level: 'medium', color: '#f59e0b', what: 'Phishing / drainer lists; hop-2 traces; small hop-1 flows ($50–$1,000); THORChain accounts linked to a listed address; the same-key twin of a high-risk address.' },
		{ level: 'low', color: '#94a3b8', what: 'Hop-3 traces and weak links. Reported with evidence, never flagged by the default policy.' },
		{ level: 'info', color: '#64748b', what: 'History: delisted, unfrozen or un-blacklisted addresses. Shown for transparency, never flagged.' }
	];

	function fmtDate(s: string | null) {
		return s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
	}
</script>

<svelte:head>
	<title>Methodology — How Ozone Screens and Traces | Ozone</title>
	<meta name="description" content="Sources, provenance, address normalization, THORChain flow tracing, risk levels, signed snapshots, privacy, limitations and appeals — how Ozone decides what it flags." />
	<meta property="og:url" content="https://ozone.redacted.gg/methodology" />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 pt-20 pb-16">
	<div class="text-center mb-12" class:hero-visible={heroVisible}>
		<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 hero-badge">
			<span class="text-[10px] font-mono tracking-wider uppercase" style="color: var(--text-muted);">Open data &middot; Signed &middot; Reproducible</span>
		</div>
		<h1 class="hero-title text-4xl sm:text-5xl font-bold tracking-tight mb-4">How Ozone <span class="hero-gradient">decides</span></h1>
		<p class="text-sm sm:text-base max-w-2xl mx-auto" style="color: var(--text-muted);">
			Every verdict names its sources and the evidence behind it. This page states exactly what Ozone checks, how, and what it cannot see.
		</p>
		{#if data.coverage}
			<div class="flex flex-wrap justify-center gap-2 mt-6">
				<span class="chip"><strong>{data.coverage.listed.toLocaleString('en-US')}</strong>&nbsp;listed addresses</span>
				<span class="chip"><strong>{data.coverage.traced.toLocaleString('en-US')}</strong>&nbsp;traced via THORChain</span>
				<span class="chip"><strong>{data.coverage.flaggedUsers.toLocaleString('en-US')}</strong>&nbsp;flagged THORChain users</span>
				<span class="chip"><strong>{data.coverage.delisted.toLocaleString('en-US')}</strong>&nbsp;delisted (history)</span>
				{#if data.coverage.snapshot}<span class="chip">snapshot v{data.coverage.snapshot.version}</span>{/if}
			</div>
		{/if}
	</div>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="overview" data-win-title="Overview">
		<h2 class="h2">In short</h2>
		<ol class="list">
			<li><strong>Lists</strong> — official sanctions (OFAC, UK, EU), law-enforcement attributions (FBI), stablecoin issuer freezes (Tether, Circle), hack/exploit and phishing lists. Every entry keeps its source, a reference link, when the source listed it, when Ozone first saw it and — if it happened — when it was removed.</li>
			<li><strong>Addresses on every THORChain chain</strong> — THOR, BTC, ETH, BSC, BASE, AVAX, GAIA, LTC, BCH, DOGE, TRON, XRP, SOL (plus ZEC, XMR, DASH, BSV, BTG, ETC, ARB, BNB Beacon for listed addresses) are validated with their checksums and reduced to one canonical form.</li>
			<li><strong>THORChain tracing</strong> — value that leaves a listed address through THORChain is followed to its recipients (swaps incl. streaming and L1→L1, sends, LP withdrawals, THORNames), which are flagged with the transaction as evidence.</li>
			<li><strong>Verdicts</strong> — each address gets a risk level and human-readable reasons. The default policy flags at risk <em>high</em>; relayer nodes can choose their own threshold.</li>
			<li><strong>Snapshots</strong> — everything above is published as a signed, versioned snapshot. Nodes verify it and screen locally, without asking Ozone at request time.</li>
		</ol>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="sources" data-win-title="Sources">
		<h2 class="h2">Sources</h2>
		<p class="p">Public sources only; none needs an API key. A download that is too small or would remove too many entries at once is refused, so a truncated file can never mass-delist sanctioned addresses.</p>
		<div class="overflow-x-auto">
			<table class="w-full text-left text-xs">
				<thead>
					<tr style="border-bottom: 1px solid var(--app-border);">
						<th class="th">Source</th>
						<th class="th">Active</th>
						<th class="th">History</th>
						<th class="th">Last sync</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sources as s}
						<tr style="border-bottom: 1px solid var(--app-border-subtle);">
							<td class="td">
								<a href={s.url} target="_blank" rel="noopener" class="font-semibold" style="color: {kindColors[s.kind] ?? 'var(--text)'};">{s.name}</a>
								<div style="color: var(--text-muted);">{s.description}</div>
								{#if s.error}<div style="color: #ef4444;">last attempt failed: {s.error}</div>{/if}
							</td>
							<td class="td font-mono">{s.active?.toLocaleString('en-US') ?? '—'}</td>
							<td class="td font-mono">{s.removed?.toLocaleString('en-US') ?? '—'}</td>
							<td class="td" style="color: var(--text-muted);">{fmtDate(s.lastSuccessAt)}{#if s.version}<div class="font-mono">{s.version}</div>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="p mt-4"><strong>Curated attributions.</strong> {data.curatedPolicy}</p>
		<p class="p"><strong>Not used:</strong> Israel's NBCTF seizure lists (the site blocks automated access), commercial APIs that need keys, and OpenSanctions' processed data (non-commercial licence) — Ozone reads the primary lists directly.</p>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="addresses" data-win-title="Addresses">
		<h2 class="h2">Address normalization</h2>
		<ul class="list">
			<li><strong>EVM</strong> (ETH, BSC, BASE, AVAX, ARB, …): lower-cased; one key for all EVM chains — an account is the same key holder everywhere.</li>
			<li><strong>Bitcoin, Litecoin, Dogecoin</strong>: base58check (case-sensitive, checksum verified) or bech32/bech32m (segwit v0 and taproot, lower-cased).</li>
			<li><strong>Bitcoin Cash</strong>: cashaddr without the <code>bitcoincash:</code> prefix — the form THORChain uses; legacy <code>1…/3…</code> BCH addresses are converted.</li>
			<li><strong>TRON</strong>: base58check <code>T…</code>; the hex form TronGrid returns is converted (the previous worker stored it as <code>0x…</code>, so TRON inputs never matched).</li>
			<li><strong>XRP</strong> (classic <code>r…</code>, XRP alphabet checksum), <strong>Solana</strong> (32-byte base58), <strong>THOR / Cosmos</strong> (bech32).</li>
			<li id="twins"><strong>Same-key twins</strong>: a TRON address and the EVM address with the same 20-byte key hash, and a pay-to-pubkey-hash address across BTC/BCH/LTC/DOGE, are controlled by the same private key. For sanctions, law-enforcement attributions, issuer freezes and maintainer flags (an identified holder), the twin carries the listing one risk level lower; hack-cluster and phishing addresses are single-use and are not twinned.</li>
			<li>Lists sometimes mislabel formats (e.g. a TRON address published under the XBT ticker, USDT on Omni as bitcoin addresses); Ozone trusts the checksum-verified format and notes the mismatch. Identifiers that are not valid addresses are rejected and reported, never imported.</li>
		</ul>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="tracing" data-win-title="THORChain tracing">
		<h2 class="h2">THORChain flow tracing</h2>
		<p class="p">Laundering through THORChain rarely touches a thor1 account: the Bybit funds (Feb–Mar 2025) went ETH → BTC directly. Ozone therefore follows <em>flows</em>, not accounts:</p>
		<ul class="list">
			<li><strong>Followed</strong>: swaps (including streaming and L1→L1), native sends, trade/secured-asset moves, LP withdrawals (to the member's payout addresses), LP pairing (asset and RUNE side of one deposit co-own the position) and THORNames (owner ↔ alias).</li>
			<li><strong>Hops</strong>: at most {data.trace.maxHops}. A traced address propagates only flows that happen <em>after</em> it received the tainted value.</li>
			<li><strong>Decay</strong>: traced risk is capped at <em>high</em> and drops one level per extra hop (hop 1 high, hop 2 medium, hop 3 low).</li>
			<li><strong>Amounts</strong>: flows under ${data.trace.dustUsd} are ignored (dusting resistance); hop-1 flows under ${data.trace.hop1FullUsd.toLocaleString('en-US')} and deeper flows under ${data.trace.deepFullUsd.toLocaleString('en-US')} lose one more level. Swap values use the price at the time from Midgard; other flows use current pool prices (approximation, only used against the thresholds).</li>
			<li><strong>Never flagged by a flow</strong>: affiliate fee outputs, THORChain module accounts (asgard, reserve, bond, affiliate collector, …), CosmWasm contracts, and services (addresses with more than 2,000 THORChain actions).</li>
			<li><strong>Coverage</strong>: history is backfilled per flagged address, and a real-time follower processes every new THORChain action. (Midgard's address filter is case-sensitive: senders are stored as observed on chain — lower-case for EVM — which is the form the backfill queries; memo destinations keep the user's spelling, which is why normalization happens on Ozone's side.)</li>
		</ul>
		<p class="p" id="clusters"><strong>Hack clusters.</strong> Attribution lists name the first addresses of a heist; the THORChain swaps are made from the next layer. For named incidents Ozone follows plain ETH transfers out of the attributed addresses inside the laundering window, above a value threshold, and stops at services and contract calls:</p>
		<ul class="list">
			{#each data.clusters as k}
				<li><a href={k.ref} target="_blank" rel="noopener" style="color: var(--app-accent);">{k.name}</a> — window {k.window.from.slice(0, 10)} → {k.window.to.slice(0, 10)}, transfers ≥ {k.minValueEth} ETH, depth ≤ {k.maxDepth} (depth ≤ 2 high risk, 3 medium).</li>
			{/each}
		</ul>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="verdicts" data-win-title="Verdicts">
		<h2 class="h2">Verdicts and risk levels</h2>
		<div class="space-y-2 mb-4">
			{#each risks as r}
				<div class="flex gap-3 items-start">
					<span class="shrink-0 w-16 text-xs font-bold uppercase" style="color: {r.color};">{r.level}</span>
					<span class="text-xs" style="color: var(--text-muted);">{r.what}</span>
				</div>
			{/each}
		</div>
		<p class="p">A verdict is <em>flagged</em> when any active reason reaches the policy threshold (default <em>high</em>). Every reason carries its source, category, provenance link and dates; traced reasons carry the hop, the THORChain transaction, the amount and the listed origin.</p>
		<p class="p" id="users"><strong>Flagged THORChain users</strong> are monitored thor1 accounts whose own address is flagged, or which are linked (by their Midgard history) to a listed L1 address — a link counts one level lower, because a linked address can be a counterparty. Links through affiliate outputs and hub accounts are ignored: the previous screener flagged exactly two accounts, and both were fee collectors (THORChain's affiliate-collector module and an interface's affiliate address) linked to tens of thousands of unrelated swappers.</p>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="snapshots" data-win-title="Snapshots">
		<h2 class="h2">Signed snapshots and node-local screening</h2>
		<ul class="list">
			<li>The worker publishes a snapshot every few minutes: a small manifest (version, build time, SHA-256 of the payload) signed with Ed25519, and the gzip payload with every listed and traced address and its reasons.</li>
			<li>Nodes pin Ozone's public key, verify the signature and the payload hash, refuse older versions (anti-rollback) and screen locally — Ozone never learns which address a node screened.</li>
			<li>If Ozone is unreachable, nodes keep screening against the last verified snapshot; every verdict reports the snapshot version and age.</li>
			<li>Online answers (<code>/api/v1/screen</code>) and certificates are signed too. Keys: <a href="/api/v1/keys" style="color: var(--app-accent);">/api/v1/keys</a>. Format and client: <a href="https://github.com/redactedLabs/OZONE/blob/main/INTEGRATION.md" target="_blank" rel="noopener" style="color: var(--app-accent);">INTEGRATION.md</a>.</li>
		</ul>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="privacy" data-win-title="Privacy">
		<h2 class="h2">Privacy</h2>
		<ul class="list">
			<li>No IP addresses are logged or stored — not for API calls, not for reports, not for admin sessions.</li>
			<li>The screening API is stateless: screened addresses are neither stored nor logged. (Hosting providers may keep their own access logs; nodes that want zero exposure screen locally from the snapshot.)</li>
			<li>Stored on request only: certificates (address + verdict, by design shareable) and reports/appeals (what you type; the contact field is optional).</li>
		</ul>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8 mb-6" id="limits" data-win-title="Limitations">
		<h2 class="h2">Limitations — what Ozone cannot see</h2>
		<ul class="list">
			<li>Transfers outside THORChain are not traced (except the Ethereum hack clusters above). A launderer who moves funds L1-to-L1 before touching THORChain is only caught if an intermediate address is listed.</li>
			<li>Lists lag reality: community lists publish with delays, sanctions add addresses weeks after the fact, Tether and Circle only freeze what they are asked to.</li>
			<li>Traces are evidence of a flow, not of intent: a hop-1 recipient may be an exchange deposit address or a victim of deliberate "dusting" (hence the amount thresholds and decay). Read the reason before acting on it.</li>
			<li>Current pool prices approximate the value of non-swap flows.</li>
			<li>Midgard is the source of THORChain history; if it misses an action, so does Ozone.</li>
		</ul>
	</section>

	<section class="card rounded-2xl p-6 sm:p-8" id="manual" data-win-title="Reports and appeals">
		<h2 class="h2">Reports and appeals</h2>
		<p class="p">Report an address with evidence, or appeal a flag you believe is wrong: <a href="/submit" style="color: var(--app-accent);">ozone.redacted.gg/submit</a>. Maintainers review every submission; an accepted report becomes a maintainer flag with a written reason, an accepted appeal suppresses derived and community reasons for that address. Official sanctions listings cannot be removed by Ozone — only by the authority that published them — and the appeal answer says so.</p>
	</section>
</div>

<style>
	.hero-badge {
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.15);
		opacity: 0;
		transform: translateY(8px);
		transition: opacity 0.5s ease 0.1s, transform 0.5s ease 0.1s;
	}
	.hero-visible .hero-badge {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-title {
		color: var(--text);
		font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
		letter-spacing: -0.03em;
	}
	.hero-gradient {
		background: linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
		scroll-margin-top: 80px;
	}
	.chip {
		font-size: 11px;
		padding: 4px 10px;
		border-radius: 999px;
		color: var(--text-muted);
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.15);
	}
	.h2 {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
		margin-bottom: 0.75rem;
	}
	.p {
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}
	.list {
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--text-secondary);
		padding-left: 1.1rem;
		list-style: disc;
		margin-bottom: 0.75rem;
	}
	ol.list {
		list-style: decimal;
	}
	.list li {
		margin-bottom: 0.4rem;
	}
	.th {
		padding: 8px 10px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.td {
		padding: 8px 10px;
		vertical-align: top;
		color: var(--text);
	}
	code {
		font-size: 0.75rem;
		padding: 1px 4px;
		border-radius: 4px;
		background: var(--bg-code);
	}
</style>
