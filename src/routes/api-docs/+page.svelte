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
			const res = await fetch(`/api/screen?address=${encodeURIComponent(testAddress.trim())}`);
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
  "address": "thor1abc...xyz",
  "flagged": true,
  "matches": [
    {
      "address": "0x1234...abcd",
      "chain": "ETH",
      "source": "OFAC",
      "entityName": "Lazarus Group",
      "reason": "OFAC SDN List"
    }
  ]
}`;

	const exampleClean = `{
  "address": "thor1qpx...m4g",
  "flagged": false,
  "matches": []
}`;

	const curlExample = `curl "https://ozone.redacted.gg/api/screen?address=thor1..."`;
	const jsExample = `const res = await fetch(
  "https://ozone.redacted.gg/api/screen?address=" + address
);
const { flagged, matches } = await res.json();

if (flagged) {
  // Block transaction
  console.log("Address is sanctioned:", matches);
}`;
	const pythonExample = `import requests

r = requests.get(
    "https://ozone.redacted.gg/api/screen",
    params={"address": address}
)
data = r.json()

if data["flagged"]:
    print(f"BLOCKED: {data['matches']}")`;
</script>

<svelte:head>
	<title>Free Compliance Screening API — THORChain & Crypto | Ozone</title>
	<meta name="description" content="Free REST API for crypto compliance screening. Check any address against OFAC, EU sanctions, Tether frozen, hack databases. No auth required. JSON response." />
	<meta property="og:title" content="Free Compliance Screening API — Ozone" />
	<meta property="og:description" content="Screen any crypto address against OFAC, EU, Tether, hacks. No auth, no cost. REST API." />
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
			One endpoint. Every sanctions list. Screen any address against OFAC, EU sanctions, known hacks, Tether frozen wallets, and 5,000+ flagged entities — zero auth required.
		</p>
	</div>

	<!-- Endpoint Card -->
	<div class="api-card rounded-2xl p-6 mb-6" data-win-title="API Endpoint">
		<div class="flex items-center gap-3 mb-4">
			<span class="rounded-md px-2.5 py-1 text-xs font-bold" style="background: rgba(16,185,129,0.15); color: #10b981;">GET</span>
			<code class="text-sm font-mono flex-1" style="color: var(--text);">/api/screen</code>
		</div>
		<div class="overflow-x-auto rounded-xl" style="background: var(--bg); border: 1px solid var(--app-border-subtle);">
			<table class="w-full text-sm">
				<thead>
					<tr style="border-bottom: 1px solid var(--app-border);">
						<th class="px-4 py-2.5 text-left text-xs font-medium" style="color: var(--text-muted);">Parameter</th>
						<th class="px-4 py-2.5 text-left text-xs font-medium" style="color: var(--text-muted);">Type</th>
						<th class="px-4 py-2.5 text-left text-xs font-medium" style="color: var(--text-muted);">Description</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="px-4 py-2.5 font-mono text-xs" style="color: var(--stat-indigo);">address</td>
						<td class="px-4 py-2.5 text-xs" style="color: var(--text-muted);">string</td>
						<td class="px-4 py-2.5 text-xs" style="color: var(--text-secondary);">Any address — thor1..., 0x..., bc1..., T..., r...</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<!-- Response Examples -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
		<div class="api-card rounded-2xl p-5">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full" style="background: #ef4444;"></span>
					<span class="text-xs font-semibold" style="color: #ef4444;">Flagged Response</span>
				</div>
				<button onclick={() => copySnippet(exampleResponse, 'flagged')} class="copy-btn">{copied === 'flagged' ? 'Copied' : 'Copy'}</button>
			</div>
			<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{exampleResponse}</code></pre>
		</div>
		<div class="api-card rounded-2xl p-5">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full" style="background: #10b981;"></span>
					<span class="text-xs font-semibold" style="color: #10b981;">Clean Response</span>
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
					<span class="text-[10px] font-mono px-2 py-0.5 rounded" style="background: rgba(245,158,11,0.15); color: #f59e0b;">JavaScript</span>
					<button onclick={() => copySnippet(jsExample, 'js')} class="copy-btn">{copied === 'js' ? 'Copied' : 'Copy'}</button>
				</div>
				<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{jsExample}</code></pre>
			</div>
			<div>
				<div class="flex items-center justify-between mb-2">
					<span class="text-[10px] font-mono px-2 py-0.5 rounded" style="background: rgba(59,130,246,0.15); color: #3b82f6;">Python</span>
					<button onclick={() => copySnippet(pythonExample, 'py')} class="copy-btn">{copied === 'py' ? 'Copied' : 'Copy'}</button>
				</div>
				<pre class="code-block rounded-xl p-4 text-[11px] overflow-x-auto"><code>{pythonExample}</code></pre>
			</div>
		</div>
	</div>

	<!-- Live Test -->
	<div class="api-card rounded-2xl p-6 mb-6" data-win-title="Try It Live">
		<h3 class="text-sm font-semibold mb-1" style="color: var(--text);">Try it live</h3>
		<p class="text-xs mb-4" style="color: var(--text-muted);">Test any address against all compliance lists in real-time.</p>
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
			<div class="rounded-xl p-4 text-[11px] font-mono overflow-x-auto" style="background: var(--bg); border: 1px solid {testResult.flagged ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};">
				<div class="flex items-center gap-2 mb-2">
					{#if testResult.flagged}
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
		<p class="text-xs mb-4" style="color: var(--text-muted);">Returns the full dataset of all flagged THORChain addresses with their linked L1 addresses and flag reasons. Available as JSON or CSV.</p>
		<div class="flex flex-wrap gap-2">
			<a href="/api/flagged" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium text-white transition-all" style="background: var(--app-accent);">View JSON</a>
			<a href="/api/flagged?format=csv" target="_blank" class="rounded-lg px-4 py-2 text-xs font-medium transition-all" style="border: 1px solid var(--app-border); color: var(--text-muted);">Download CSV</a>
		</div>
	</div>

	<!-- Data Sources -->
	<div class="api-card rounded-2xl p-6" data-win-title="Data Sources">
		<h3 class="text-sm font-semibold mb-4" style="color: var(--text);">Data Sources</h3>
		<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
			{#each [
				{ name: 'OFAC SDN', color: '#ef4444', desc: 'US Treasury sanctions' },
				{ name: 'EU Sanctions', color: '#3b82f6', desc: 'European Union list' },
				{ name: 'Known Hacks', color: '#f59e0b', desc: 'Bybit, Ronin, Nomad...' },
				{ name: 'Tether Frozen', color: '#26a17b', desc: 'ETH + TRON blacklist' },
				{ name: 'ScamSniffer', color: '#ec4899', desc: 'Phishing database' },
				{ name: 'Eth Labels', color: '#fb923c', desc: 'Exploits & heists' },
				{ name: 'Chainalysis', color: '#a855f7', desc: 'Sanctions oracle' },
				{ name: 'Manual Flags', color: '#8b5cf6', desc: 'Team-reviewed' },
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
