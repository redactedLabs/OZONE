<script lang="ts">
	let testAddress = $state('');
	let testResult = $state<any>(null);
	let testing = $state(false);
	let copied = $state('');

	async function runTest() {
		if (!testAddress.trim()) return;
		testing = true;
		testResult = null;
		try {
			const res = await fetch('/api/v1/screen', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ addresses: [testAddress.trim()] })
			});
			testResult = await res.json();
		} catch {
			testResult = { error: 'Request failed' };
		}
		testing = false;
	}

	function copySnippet(text: string, id: string) {
		navigator.clipboard.writeText(text);
		copied = id;
		setTimeout(() => { copied = ''; }, 2000);
	}

	const exampleResponse = `{
  "type": "ozone.screen.v1",
  "id": "5f0c…",
  "issuedAt": "2026-09-27T10:00:00.000Z",
  "policy": { "flagAt": "high" },
  "snapshot": { "version": 1790500000, "builtAt": "…", "sha256": "…" },
  "results": [{
    "input": "19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE",
    "keys": ["btc:19qs8FPxK6VfkqHL7TPZDhw3r2rJPU6yhE"],
    "valid": true,
    "status": "flagged",
    "risk": "high",
    "reasons": [{
      "code": "TRACE_SWAP",
      "source": "thorchain_trace",
      "category": "traced",
      "risk": "high",
      "text": "Received 1.2133 BTC.BTC (~$111,000) from 0xb21e…69f4, listed by Bybit Exploiter 65 (ethlabels) via THORChain swap 6F708AFC… on 2025-02-25",
      "ref": "https://runescan.io/tx/6F708AFC…",
      "trace": { "hop": 1, "action": "swap", "txid": "6F708AFC…", "from": "0xb21e…69f4", "originSource": "ethlabels" }
    }],
    "reference": "oz:v1790500000:flagged:TRACE_SWAP"
  }],
  "signature": { "alg": "ed25519", "keyId": "oz…", "sig": "…" }
}`;

	const exampleClean = `{
  "input": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  "keys": ["btc:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
           "bch:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy",
           "bsv:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"],
  "valid": true,
  "status": "clean",
  "risk": "none",
  "reasons": [],
  "snapshot": { "version": 1790500000, "ageSeconds": 212,
                "stale": false, "sha256": "…" }
}`;

	const curlExample = `curl -s https://ozone.redacted.gg/api/v1/screen \\
  -H 'content-type: application/json' \\
  -d '{"addresses":["0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
                   {"address":"qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a","chain":"BCH"}],
       "policy":{"flagAt":"high"}}'`;
	// `\u0069mport` renders as "import"; the escape keeps Vite's dependency
	// scanner from treating the example code as a real import of the package.
	const jsExample = `// Online, with signature verification
\u0069mport { verifyScreenResponse } from '@redacted/ozone-client';

const res = await fetch('https://ozone.redacted.gg/api/v1/screen', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ addresses: [address] })
});
const body = verifyScreenResponse(await res.json(), [OZONE_API_KEY]);
if (!body) throw new Error('unsigned or forged answer');
const [verdict] = body.results;          // status, risk, reasons, snapshot`;
	const pythonExample = `// Node-local: no request to Ozone at screening time
\u0069mport { OzoneClient } from '@redacted/ozone-client';

const oz = new OzoneClient({
  trustedKeys: [OZONE_SNAPSHOT_KEY],     // pin it (see /api/v1/keys)
  cacheDir: '/var/lib/node/ozone',        // survives restarts and outages
});
await oz.init();                          // verified cache, then refresh
oz.start();                               // refresh every 10 min
const v = oz.screen(address, 'BTC');      // → status, risk, reasons,
                                          //   snapshot.version / ageSeconds`;
</script>


<svelte:head>
	<title>Screening API — Signed Verdicts, Snapshots | Ozone</title>
	<meta name="description" content="Batch-screen addresses on every THORChain chain. Signed verdicts with sources, provenance and THORChain trace evidence; signed snapshots for node-local screening. Free, no auth." />
	<meta property="og:title" content="Ozone Screening API" />
	<meta property="og:description" content="Signed verdicts with provenance, THORChain flow tracing and downloadable signed snapshots." />
	<meta property="og:url" content="https://ozone.redacted.gg/api-docs" />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-20 pb-16">
	<!-- Hero -->
	<div class="text-center mb-12">
		<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-4" style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);">
			<span class="inline-block h-2 w-2 rounded-full animate-pulse" style="background: #10b981;"></span>
			<span class="text-xs font-mono" style="color: var(--stat-indigo);">v1 &middot; Public &middot; Free</span>
		</div>
		<h1 class="text-3xl sm:text-4xl font-bold tracking-tight mb-3" style="color: var(--text);">Ozone Screening API</h1>
		<p class="text-sm sm:text-base max-w-2xl mx-auto" style="color: var(--text-muted);">
			Batch-screen addresses on every THORChain chain. Each verdict names its sources, provenance and — for traces — the THORChain transactions, and every answer is signed with Ozone's Ed25519 key. Nodes can instead download the signed snapshot and screen locally. No auth, nothing about the request is stored.
		</p>
	</div>

	<!-- Endpoint Cards -->
	<div class="api-card rounded-2xl p-6 mb-6" data-win-title="API Endpoints">
		<div class="overflow-x-auto rounded-xl" style="background: var(--bg); border: 1px solid var(--app-border-subtle);">
			<table class="w-full text-sm">
				<thead>
					<tr style="border-bottom: 1px solid var(--app-border);">
						<th class="px-4 py-2.5 text-left text-xs font-medium" style="color: var(--text-muted);">Endpoint</th>
						<th class="px-4 py-2.5 text-left text-xs font-medium" style="color: var(--text-muted);">What it does</th>
					</tr>
				</thead>
				<tbody>
					{#each [
						['POST /api/v1/screen', 'Batch screening (≤ 100). Body {"addresses": ["…" | {"address","chain"}], "policy": {"flagAt": "high"}}. Signed ozone.screen.v1 answer.'],
						['GET /api/v1/screen?address=&chain=', 'Same for one address.'],
						['GET /api/screen?address=', 'Original endpoint, kept compatible: flagged + matches[].source, plus the signed v1 answer as "attestation".'],
						['GET /api/v1/address/<address>', 'Everything about one address: verdict, every listing with provenance (history included), THORChain flows received and sent, and the small transfers (each under $50) that count toward a TRACE_SMALL_TRANSFERS total.'],
						['GET /api/v1/snapshot', 'Newest signed snapshot manifest (version, build time, SHA-256 of the payload).'],
						['GET /api/v1/snapshot/<version>', 'Snapshot payload (gzip JSON of every listed and traced address with its reasons).'],
						['GET /api/v1/keys', 'Public keys that sign snapshots and answers — pin them.'],
						['GET /api/health', 'Database, snapshot age, per-source sync state, real-time trace cursor.'],
						['POST /api/v1/submissions', 'Report an address or appeal a flag ({kind, address, chain?, message, evidence?, contact?}).'],
						['GET /api/flagged', 'The flagged counters: all flagged addresses, flagged thor1 addresses, monitored thor1 accounts flagged (+ breakdown).'],
						['GET /api/flagged?list=all|thor|users', 'Each list (JSON, paged with offset/limit ≤ 1000; filter q, source, chain; format=csv for all rows).'],
					] as [ep, what]}
						<tr style="border-bottom: 1px solid var(--app-border-subtle);">
							<td class="px-4 py-2.5 font-mono text-xs whitespace-nowrap" style="color: var(--stat-indigo);">{ep}</td>
							<td class="px-4 py-2.5 text-xs" style="color: var(--text-secondary);">{what}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="text-[11px] mt-3" style="color: var(--text-faint);">
			Chains: THOR, BTC, ETH, BSC, BASE, AVAX, GAIA, LTC, BCH, DOGE, TRON, XRP, SOL (+ ZEC, XMR, DASH, BSV, BTG, ETC, ARB, BNB for listed addresses). Without a chain hint every valid reading of the address is checked.
			Risk levels and reasons: <a href="/methodology#verdicts" style="color: var(--app-accent);">methodology</a>. Node integration: INTEGRATION.md in the repository.
		</p>
	</div>

	<!-- Response Examples -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
		<div class="api-card rounded-2xl p-5">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full" style="background: #ef4444;"></span>
					<span class="text-xs font-semibold" style="color: #ef4444;">Flagged (traced) verdict</span>
				</div>
				<button onclick={() => copySnippet(exampleResponse, 'flagged')} class="copy-btn">{copied === 'flagged' ? 'Copied' : 'Copy'}</button>
			</div>
			<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{exampleResponse}</code></pre>
		</div>
		<div class="api-card rounded-2xl p-5">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full" style="background: #10b981;"></span>
					<span class="text-xs font-semibold" style="color: #10b981;">Clean verdict</span>
				</div>
				<button onclick={() => copySnippet(exampleClean, 'clean')} class="copy-btn">{copied === 'clean' ? 'Copied' : 'Copy'}</button>
			</div>
			<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{exampleClean}</code></pre>
		</div>
	</div>

	<!-- Code Examples -->
	<div class="api-card rounded-2xl p-6 mb-6" data-win-title="Integration Examples">
		<h3 class="text-sm font-semibold mb-4" style="color: var(--text);">Integration Examples</h3>
		<div class="space-y-4">
			<div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] font-mono px-2 py-0.5 rounded" style="background: rgba(99,102,241,0.15); color: var(--stat-indigo);">cURL</span>
					<button onclick={() => copySnippet(curlExample, 'curl')} class="copy-btn">{copied === 'curl' ? 'Copied' : 'Copy'}</button>
				</div>
				<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{curlExample}</code></pre>
			</div>
			<div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] font-mono px-2 py-0.5 rounded" style="background: rgba(245,158,11,0.15); color: #f59e0b;">JavaScript (verified)</span>
					<button onclick={() => copySnippet(jsExample, 'js')} class="copy-btn">{copied === 'js' ? 'Copied' : 'Copy'}</button>
				</div>
				<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{jsExample}</code></pre>
			</div>
			<div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] font-mono px-2 py-0.5 rounded" style="background: rgba(59,130,246,0.15); color: #3b82f6;">Node-local</span>
					<button onclick={() => copySnippet(pythonExample, 'py')} class="copy-btn">{copied === 'py' ? 'Copied' : 'Copy'}</button>
				</div>
				<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{pythonExample}</code></pre>
			</div>
		</div>
	</div>

	<!-- Live Test -->
	<div class="api-card rounded-2xl p-6 mb-6" data-win-title="Try It Live">
		<h3 class="text-sm font-semibold mb-1" style="color: var(--text);">Try it live</h3>
		<p class="text-xs mb-4" style="color: var(--text-muted);">POSTs to /api/v1/screen and shows the signed answer.</p>
		<div class="flex gap-2 mb-4">
			<input
				type="text"
				bind:value={testAddress}
				placeholder="thor1..., 0x..., bc1..., T..."
				class="test-input flex-1 rounded-xl px-4 py-2.5 text-sm font-mono"
				onkeydown={(e) => { if (e.key === 'Enter') runTest(); }}
			/>
			<button
				onclick={runTest}
				disabled={testing || !testAddress.trim()}
				class="rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition-all"
				style="background: var(--app-accent);"
			>
				{testing ? 'Screening...' : 'Screen'}
			</button>
		</div>
		{#if testResult}
			<div class="rounded-xl p-4 text-[11px] font-mono overflow-x-auto" style="background: var(--bg); border: 1px solid {testResult.results?.[0]?.status === 'flagged' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};">
				<div class="flex items-center gap-2 mb-2">
					{#if testResult.results?.[0]?.status === 'flagged'}
						<span class="inline-block h-2 w-2 rounded-full animate-pulse" style="background: #ef4444;"></span>
						<span class="text-xs font-semibold" style="color: #ef4444;">FLAGGED</span>
					{:else if testResult.error}
						<span class="text-xs" style="color: #ef4444;">{testResult.error}</span>
					{:else}
						<span class="inline-block h-2 w-2 rounded-full" style="background: #10b981;"></span>
						<span class="text-xs font-semibold" style="color: #10b981;">CLEAN</span>
					{/if}
				</div>
				<pre style="color: var(--text-secondary);">{JSON.stringify(testResult, null, 2)}</pre>
			</div>
		{/if}
	</div>

	<!-- Flagged Dataset -->
	<div class="api-card rounded-2xl p-6 mb-6">
		<div class="flex items-center gap-3 mb-4">
			<span class="rounded-md px-2.5 py-1 text-xs font-bold" style="background: rgba(16,185,129,0.15); color: #10b981;">GET</span>
			<code class="text-sm font-mono flex-1" style="color: var(--text);">/api/flagged</code>
		</div>
		<p class="text-xs mb-4" style="color: var(--text-muted);">Two separate numbers, each with its list: <strong>all flagged addresses</strong> (every key in the newest signed snapshot at risk ≥ high, any chain; <code>?list=all</code>) and the <strong>flagged thor1 addresses</strong> among them (<code>?list=thor</code>). Rows carry only what the snapshot publishes: address, chain, risk, reason codes, sources, incident. <code>?list=users</code> is the separate count of monitored thor1 accounts that are flagged themselves or through a linked L1 address (formerly "Flagged THORChain Users"; the legacy fields <code>totalFlagged</code>, <code>flaggedThorUsers</code> and <code>flaggedAddresses</code> of the plain call keep that meaning).</p>
		<div class="flex flex-wrap gap-2">
			<a href="/api/flagged" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium text-white transition-all" style="background: var(--app-accent);">Counters (JSON)</a>
			<a href="/api/flagged?list=all" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">All flagged (JSON)</a>
			<a href="/api/flagged?list=thor" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">thor1 flagged (JSON)</a>
			<a href="/api/flagged?list=all&format=csv" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">All flagged (CSV)</a>
		</div>
	</div>

	<!-- Data Sources -->
	<div class="api-card rounded-2xl p-6" data-win-title="Data Sources">
		<h3 class="text-sm font-semibold mb-4" style="color: var(--text);">Data Sources</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
			{#each [
				{ name: 'OFAC SDN', color: '#ef4444', desc: 'US Treasury, all tickers' },
				{ name: 'UK Sanctions', color: '#f87171', desc: 'FCDO list' },
				{ name: 'EU Sanctions', color: '#3b82f6', desc: 'Consolidated list' },
				{ name: 'Sanctions oracle', color: '#10b981', desc: 'On-chain, incl. delistings' },
				{ name: 'FBI / IC3', color: '#dc2626', desc: 'DPRK attributions' },
				{ name: 'Tether & Circle', color: '#26a17b', desc: 'Issuer freezes' },
				{ name: 'Hack clusters', color: '#f59e0b', desc: 'Bybit + curated' },
				{ name: 'Exploiter labels', color: '#fb923c', desc: 'eth-labels' },
				{ name: 'ScamSniffer', color: '#ec4899', desc: 'Phishing / drainers' },
				{ name: 'THORChain tracing', color: '#22d3ee', desc: 'Flows from listed addresses' },
				{ name: 'Same-key twins', color: '#a855f7', desc: 'TRON↔EVM, BTC/BCH/LTC/DOGE' },
				{ name: 'Maintainer flags', color: '#8b5cf6', desc: 'With written reasons' },
			] as src}
				<div class="rounded-xl p-3" style="background: var(--card-bg); border: 1px solid var(--app-border);">
					<div class="text-xs font-semibold mb-0.5" style="color: {src.color};">{src.name}</div>
					<div class="text-[10px]" style="color: var(--text-faint);">{src.desc}</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.api-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(4px);
	}
	.code-block {
		background: var(--bg-code);
		border: 1px solid var(--app-border-subtle);
		color: var(--text-secondary);
		line-height: 1.6;
	}
	.copy-btn {
		font-size: 11px;
		color: var(--text-muted);
		padding: 2px 8px;
		border-radius: 6px;
		border: 1px solid var(--app-border);
		transition: all 0.15s;
	}
	.copy-btn:hover { color: var(--text); border-color: var(--text-ghost); }
	.test-input {
		background: var(--bg);
		border: 1px solid var(--app-border);
		color: var(--text);
		outline: none;
	}
	.test-input:focus { border-color: var(--app-accent); }
	.test-input::placeholder { color: var(--text-faint); }
</style>
