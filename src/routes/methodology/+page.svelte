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
		{ level: 'high', color: '#f97316', what: 'Hack and exploiter addresses, stablecoin issuer freezes, maintainer flags; addresses that received ≥ $1,000 in total directly from a listed address through THORChain (hop 1), in one transfer or many; the first two layers of an attributed hack cluster.' },
		{ level: 'medium', color: '#f59e0b', what: 'Phishing / drainer lists; hop-2 traces; hop-1 totals of $50–$1,000; THORChain accounts linked to a listed address; the same-key twin of a high-risk address.' },
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
				<span class="chip"><strong>{data.coverage.flaggedUsers.toLocaleString('en-US')}</strong>&nbsp;monitored thor1 accounts flagged</span>
				<span class="chip"><strong>{data.coverage.delisted.toLocaleString('en-US')}</strong>&nbsp;delisted (history)</span>
				{#if data.coverage.snapshot}<span class="chip">snapshot v{data.coverage.snapshot.version}</span>{/if}
			</div>
		{/if}
	</div>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="overview" data-win-title="Overview">
		<h2 class="h2">In short</h2>
		<ol class="list">
			<li><strong>Lists</strong> — official sanctions (OFAC, UK, EU, and the on-chain sanctions oracle on Ethereum, Arbitrum, Optimism, Polygon, Avalanche and Base), law-enforcement attributions (FBI), stablecoin issuer freezes (Tether on Ethereum, TRON and Avalanche, USDT0 on Arbitrum and Polygon, Circle on Ethereum, Base, Avalanche, Arbitrum, Optimism and Polygon), hack/exploit and phishing lists, and maintainer flags for freshly announced hacks. Every entry keeps its source, a reference link, when the source listed it, when Ozone first saw it and — if it happened — when it was removed.</li>
			<li><strong>Addresses on every THORChain chain</strong> — THOR, BTC, ETH, BSC, BASE, AVAX, GAIA, LTC, BCH, DOGE, TRON, XRP, SOL (plus ZEC, XMR, DASH, BSV, BTG, ETC, ARB, BNB Beacon for listed addresses) are validated with their checksums and reduced to one canonical form.</li>
			<li><strong>THORChain tracing</strong> — value that leaves a listed address through THORChain is followed to its recipients (swaps incl. streaming and L1→L1, sends, LP withdrawals, THORNames), which are flagged with the transaction as evidence.</li>
			<li><strong>Verdicts</strong> — each address gets a risk level and human-readable reasons. The default policy flags at risk <em>high</em>; relayer nodes can choose their own threshold.</li>
			<li><strong>Snapshots</strong> — everything above is published as a signed, versioned snapshot. Nodes verify it and screen locally, without asking Ozone at request time.</li>
		</ol>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="sources" data-win-title="Sources">
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
		<p class="p mt-4" id="hack-incidents"><strong>Hack incidents.</strong> {data.curatedPolicy}</p>
		<div class="overflow-x-auto mt-3">
			<table class="w-full text-left text-[11px]">
				<thead>
					<tr style="border-bottom: 1px solid var(--app-border);">
						<th class="py-2 pr-3 font-medium" style="color: var(--text-muted);">Incident</th>
						<th class="py-2 pr-3 font-medium" style="color: var(--text-muted);">Chains</th>
						<th class="py-2 pr-3 font-medium" style="color: var(--text-muted);">Addresses</th>
						<th class="py-2 pr-3 font-medium" style="color: var(--text-muted);">Through THORChain</th>
						<th class="py-2 font-medium" style="color: var(--text-muted);">Sources</th>
					</tr>
				</thead>
				<tbody>
					{#each data.incidents as inc}
						<tr style="border-bottom: 1px solid var(--app-border-subtle);">
							<td class="py-1.5 pr-3"><a href={inc.ref} target="_blank" rel="noopener" style="color: var(--app-accent);">{inc.name}</a></td>
							<td class="py-1.5 pr-3 font-mono" style="color: var(--text-muted);">{inc.chains.join(' ')}</td>
							<td class="py-1.5 pr-3 font-mono" style="color: var(--text);">{inc.addresses}{#if inc.delisted} <span style="color: var(--text-faint);">(+{inc.delisted} history)</span>{/if}</td>
							<td class="py-1.5 pr-3">{#if inc.thorchain.ref}<a href={inc.thorchain.ref} target="_blank" rel="noopener" style="color: var(--app-accent);">{inc.thorchain.used}</a>{:else}<span style="color: var(--text-muted);">{inc.thorchain.used}</span>{/if}</td>
							<td class="py-1.5" style="color: var(--text-muted);">{inc.sourceTypes.join(', ')} · {inc.confidence.join('/')}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="p mt-3"><strong>Researched without a usable address list:</strong> {data.searched.map((s) => `${s.name} (${s.date})`).join('; ')}. Each entry says why in the dataset.</p>
		<p class="p"><strong>Not used:</strong> Israel's NBCTF seizure lists (the site blocks automated access), commercial APIs that need keys, and OpenSanctions' processed data (non-commercial licence) — Ozone reads the primary lists directly. (Only when the EU's own endpoint fails does Ozone fetch OpenSanctions' unmodified copy of the same official EU XML file.)</p>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="addresses" data-win-title="Addresses">
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

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="tracing" data-win-title="THORChain tracing">
		<h2 class="h2">THORChain flow tracing</h2>
		<p class="p">Laundering through THORChain rarely touches a thor1 account: the Bybit funds (Feb–Mar 2025) went ETH → BTC directly. Ozone therefore follows <em>flows</em>, not accounts:</p>
		<ul class="list">
			<li><strong>Followed</strong>: swaps (including streaming and L1→L1), native sends, trade/secured-asset moves, LP withdrawals (to the member's payout addresses), LP pairing (asset and RUNE side of one deposit co-own the position) and THORNames (owner ↔ alias).</li>
			<li><strong>Hops</strong>: at most {data.trace.maxHops}. A traced address propagates only flows that happen <em>after</em> it received the tainted value; likewise a hack-cluster member only from the start of its incident (earlier activity cannot be the proceeds).</li>
			<li><strong>Decay</strong>: traced risk is capped at <em>high</em> and drops one level per extra hop (hop 1 high, hop 2 medium, hop 3 low).</li>
			<li><strong>Amounts</strong>: value from the same listed origin to the same recipient at the same hop is added up — each THORChain transaction once, however often it is re-read. A total under ${data.trace.dustUsd} flags nothing (dusting resistance); hop-1 totals under ${data.trace.hop1FullUsd.toLocaleString('en-US')} and deeper totals under ${data.trace.deepFullUsd.toLocaleString('en-US')} lose one more level. Swap values use the price at the time from Midgard; other flows use current pool prices (approximation, only used against the thresholds).</li>
			<li><strong>Many small transfers</strong>: a recipient built entirely from transfers under ${data.trace.dustUsd} each is traced once they add up to ${data.trace.dustUsd} — with the risk one transfer of that total would get, tainted from the transfer that reached it, and followed onward like any traced address. Its reason (<code>TRACE_SMALL_TRANSFERS</code>) names the total, the number of transfers and the origin. Only transfers a flagged address signed itself count; anyone else's transfers never do. At most {data.trace.maxDustRecipients} such recipients per listed origin and hop are followed further; beyond that they are still flagged, but not traced onward.</li>
			<li><strong>Never flagged by a flow</strong>: affiliate fee outputs, THORChain module accounts (asgard, reserve, bond, affiliate collector, …), CosmWasm contracts, and services (addresses with more than 2,000 THORChain actions).</li>
			<li><strong>Coverage</strong>: history is backfilled per flagged address — oldest first and to the end, over several passes for long histories — and a real-time follower processes every new THORChain action in chain order; after an outage it catches up from where it stopped instead of skipping ahead. The backfill reads incident keys first (see below), then by risk; within one risk level it reads traced addresses first (they are proven THORChain users), then attributions (sanctions, law enforcement, hacks, maintainer flags), then bulk lists (issuer freezes, phishing lists), then same-key twins. (Midgard's address filter is case-sensitive: senders are stored as observed on chain — lower-case for EVM — which is the form the backfill queries; memo destinations keep the user's spelling, which is why normalization happens on Ozone's side.)</li>
			<li id="incidents"><strong>Freshly announced hacks</strong>: no public list carries a new hacker's addresses on day one. A maintainer pastes them, with the public source (post-mortem, law-enforcement release, investigator thread), as maintainer flags marked urgent. The worker notices within seconds, lists them, reads their THORChain history — and that of every recipient it finds, hop after hop — before anything else, and publishes a signed snapshot right away, typically within minutes. The urgency lasts 48 hours; the flags stay until a maintainer removes them.</li>
		</ul>
		<p class="p" id="clusters"><strong>Hack clusters.</strong> Attribution lists name the first addresses of a heist; the THORChain swaps are made from the next layer. For every incident Ozone follows native-coin transfers out of its attacker addresses on their own chain (Ethereum and the EVM chains, Bitcoin, Litecoin), inside the laundering window (by default the theft date plus {data.windowDays} days), above a value threshold and up to a hop limit. It stops at services (addresses with many transactions: exchanges, THORChain vaults), contract calls (router and bridge deposits, DEX swaps), contracts (bridges, routers, mixers, smart wallets — checked on chain), CoinJoins and THORChain deposits. Members are listed with the incident's name (depth ≤ 2 high risk, 3 medium) and traced through THORChain from the start of their incident. Each run has a request budget; a run cut short records where it stopped and the next run resumes there, so no cap is silent. Pasted maintainer incidents are expanded right away; the rest weekly while their window is open.</p>
		<ul class="list">
			{#each data.chainDefaults as c}
				<li><strong>{c.chain}</strong>: transfers ≥ {c.minValue} (native units), depth ≤ {c.maxDepth}, ≤ {c.maxRequests.toLocaleString('en-US')} explorer requests per cluster and run</li>
			{/each}
			{#each data.clusters as k}
				<li><a href={k.ref} target="_blank" rel="noopener" style="color: var(--app-accent);">{k.name}</a> ({k.chain}) — window {k.window.from.slice(0, 10)} → {k.window.to.slice(0, 10)}, transfers ≥ {k.minValue}, depth ≤ {k.maxDepth}, seeded from the FBI list and exploiter labels.</li>
			{/each}
		</ul>
		<p class="p" id="watch"><strong>New hack money arriving at THORChain.</strong> Launderers rarely deposit straight from an attributed address. For every new THORChain inbound of ${data.watch.minUsd.toLocaleString('en-US')} or more from an L1 address that no list or trace covers, Ozone looks back {data.watch.hops === 2 ? 'one and two hops' : 'one hop'} at who funded the sender on its own chain (the last {data.watch.lookbackDays} days; for Bitcoin and Litecoin the inputs of the deposit and of the transactions that funded them). If a funder is listed or traced, the depositor is traced with the reason "funded by … one hop before THORChain" (code <code>TRACE_L1_FUNDING</code>, two hops: <code>TRACE_L1_FUNDING2</code>, one risk level lower) and its THORChain outputs are traced from its deposit on. Look-backs run in a queue beside the real-time follower (never inside it), at most {data.watch.maxFunders} funders per hop, cached per address; exchanges, contracts and CoinJoins are skipped.</p>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="verdicts" data-win-title="Verdicts">
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
		<p class="p" id="numbers"><strong>The numbers on the home page</strong> have one meaning each, and each links to its list:</p>
		<ul class="list">
			<li><strong>Flagged addresses (all chains)</strong> — every address in the newest signed snapshot whose active reasons reach risk <em>high</em> or above: listed, traced through THORChain, linked, or controlled by the same key as a listing. Each address (key) counts once, however many reasons it has; an EVM key counts once for all EVM chains. <a href="/flagged" style="color: var(--app-accent);">List</a> · <a href="/api/flagged?list=all" style="color: var(--app-accent);">JSON</a></li>
			<li><strong>Flagged THORChain (thor1) addresses</strong> — the thor1 addresses among them. <a href="/flagged?list=thor" style="color: var(--app-accent);">List</a> · <a href="/api/flagged?list=thor" style="color: var(--app-accent);">JSON</a></li>
			<li><strong>Listed addresses</strong> — distinct addresses on at least one list at any risk (medium-risk phishing entries are listed, not flagged). <a href="/banned" style="color: var(--app-accent);">List</a></li>
			<li><strong>Monitored thor1 accounts · flagged</strong> — thor1 accounts Ozone watches (Rujira League, LPs, live transactions), and how many of them are flagged themselves or linked to a listed L1 address (formerly "Flagged THORChain users"; see below). <a href="/screening" style="color: var(--app-accent);">List</a></li>
		</ul>
		<p class="p">The two flagged lists show only what the signed snapshot publishes: address, chain, risk, reason codes, sources and the incident or entity behind it.</p>
		<p class="p" id="users"><strong>Monitored thor1 accounts flagged</strong> (formerly "Flagged THORChain users") are monitored thor1 accounts whose own address is flagged, or which are linked (by their own signed actions in their Midgard history) to a listed L1 address — a link counts one level lower, because a linked address can be a counterparty. Links through affiliate outputs and hub accounts are ignored: the previous screener flagged exactly two accounts, and both were fee collectors (THORChain's affiliate-collector module and an interface's affiliate address) linked to tens of thousands of unrelated swappers. A flagged monitored account also appears in the thor1 list (from the next snapshot on, which publishes its links); the thor1 list is larger because it also covers addresses Ozone does not monitor.</p>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="snapshots" data-win-title="Snapshots">
		<h2 class="h2">Signed snapshots and node-local screening</h2>
		<ul class="list">
			<li>The worker checks every 10 minutes and publishes a new snapshot when anything changed (and at least every 6 hours): a small manifest (version, build time, SHA-256 of the payload) signed with Ed25519, and the gzip payload with every listed and traced address and its reasons.</li>
			<li>Nodes pin Ozone's public key, verify the signature and the payload hash, refuse older versions (anti-rollback) and screen locally — Ozone never learns which address a node screened.</li>
			<li>If Ozone is unreachable, nodes keep screening against the last verified snapshot; every verdict reports the snapshot version and age.</li>
			<li>Online answers (<code>/api/v1/screen</code>) and certificates are signed too. Keys: <a href="/api/v1/keys" style="color: var(--app-accent);">/api/v1/keys</a>. Format and client: <a href="https://github.com/redactedLabs/OZONE/blob/main/INTEGRATION.md" target="_blank" rel="noopener" style="color: var(--app-accent);">INTEGRATION.md</a>.</li>
		</ul>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="privacy" data-win-title="Privacy">
		<h2 class="h2">Privacy</h2>
		<ul class="list">
			<li>No IP addresses are logged or stored — not for API calls, not for reports, not for admin sessions.</li>
			<li>The screening API is stateless: screened addresses are neither stored nor logged. (Hosting providers may keep their own access logs; nodes that want zero exposure screen locally from the snapshot.)</li>
			<li>Stored on request only: certificates (address + verdict, by design shareable) and reports/appeals (what you type; the contact field is optional).</li>
		</ul>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8 mb-6" id="limits" data-win-title="Limitations">
		<h2 class="h2">Limitations — what Ozone cannot see</h2>
		<ul class="list">
			<li>Transfers outside THORChain are traced only by the hack clusters (from attributed addresses forward) and the inbound watcher (from large THORChain deposits one or two hops back). A launderer who inserts more L1 hops, or deposits less than the watcher's threshold, is only caught if an intermediate address is listed.</li>
			<li>Hack clusters follow native-coin transfers only (no token transfers or contract-internal transfers), inside the incident window and within a request budget. Keyless explorers limit which chains are covered: Ethereum and Avalanche through routescan, Bitcoin and Litecoin through public Esplora servers; other EVM chains only at a trickle (a keyless Blockscout instance allows about 10 requests an hour) unless an Etherscan or Blockscout key is configured.</li>
			<li>Lists lag reality: community lists publish with delays, sanctions add addresses weeks after the fact, Tether and Circle only freeze what they are asked to. Freshly announced hacks reach Ozone only when a maintainer lists them (see <a href="#incidents" style="color: var(--app-accent);">freshly announced hacks</a>).</li>
			<li>Traces are evidence of a flow, not of intent: a hop-1 recipient may be an exchange deposit address or a victim of deliberate "dusting" (hence the amount thresholds and decay: dusting an address costs at least ${data.trace.dustUsd} in total). Read the reason before acting on it.</li>
			<li>Current pool prices approximate the value of non-swap flows.</li>
			<li>Midgard is the source of THORChain history; if it misses an action, so does Ozone.</li>
		</ul>
	</section>

	<section class="card api-card rounded-2xl p-6 sm:p-8" id="manual" data-win-title="Reports and appeals">
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
	/* Win98: the theme recolours inline styles and elements; class-based text needs the same (black on silver). */
	:global(.win98) .p,
	:global(.win98) .list,
	:global(.win98) .th,
	:global(.win98) .td,
	:global(.win98) .h2 {
		color: #000;
	}
	:global(.win98) .chip {
		color: #000;
		background: #c0c0c0;
		border: 1px solid #808080;
		border-radius: 0;
	}
	:global(.win98) code {
		background: #fff;
		border-radius: 0;
	}
</style>
