<script lang="ts">
	import { page } from '$app/state';

	let kind = $state<'report' | 'appeal'>(page.url.searchParams.get('kind') === 'appeal' ? 'appeal' : 'report');
	let address = $state(page.url.searchParams.get('address') ?? '');
	let chain = $state('');
	let message = $state('');
	let evidence = $state('');
	let contact = $state('');
	let website = $state(''); // honeypot, must stay empty
	let busy = $state(false);
	let error = $state('');
	let done = $state<{ publicId: string; statusUrl: string } | null>(null);

	async function submit() {
		error = '';
		busy = true;
		try {
			const res = await fetch('/api/v1/submissions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind, address, chain: chain || undefined, message, evidence, contact, website })
			});
			const body = await res.json();
			if (!res.ok) error = body.error ?? 'Submission failed';
			else done = body;
		} catch {
			error = 'Network error';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Report an Address or Appeal a Flag | Ozone</title>
	<meta name="description" content="Report a sanctioned, hacked or scam address with evidence, or appeal an Ozone flag you believe is wrong. No IP address or other request data is stored." />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 pt-20 pb-16">
	<h1 class="text-2xl font-bold mb-1" style="color: var(--text);">{kind === 'report' ? 'Report an address' : 'Appeal a flag'}</h1>
	<p class="text-sm mb-6" style="color: var(--text-muted);">
		Maintainers review every submission. Nothing about your request (IP address, browser) is stored — only what you type below.
		See the <a href="/methodology#manual" style="color: var(--app-accent);">methodology</a> for how reports and appeals are handled.
	</p>

	<div class="flex gap-2 mb-4">
		<button class="tab" class:active={kind === 'report'} onclick={() => (kind = 'report')}>Report an address</button>
		<button class="tab" class:active={kind === 'appeal'} onclick={() => (kind = 'appeal')}>Appeal / delisting request</button>
	</div>

	{#if done}
		<div class="card rounded-2xl p-6" data-win-title="Submitted">
			<div class="text-lg font-semibold mb-2" style="color: #10b981;">Received</div>
			<p class="text-sm mb-3" style="color: var(--text-secondary);">Keep this reference to follow the review:</p>
			<div class="font-mono text-sm mb-4" style="color: var(--text);">{done.publicId}</div>
			<a href={done.statusUrl} class="btn">Check status</a>
		</div>
	{:else}
		<form class="card rounded-2xl p-6 space-y-4" data-win-title={kind === 'report' ? 'Report' : 'Appeal'} onsubmit={(e) => { e.preventDefault(); submit(); }}>
			<label class="block">
				<span class="label">Address</span>
				<input class="input font-mono" bind:value={address} required maxlength="128" placeholder="0x…, bc1…, thor1…, T…" />
			</label>
			<label class="block">
				<span class="label">Chain (optional — detected from the format)</span>
				<select class="input" bind:value={chain}>
					<option value="">auto-detect</option>
					{#each ['THOR', 'BTC', 'ETH', 'BSC', 'BASE', 'AVAX', 'GAIA', 'LTC', 'BCH', 'DOGE', 'TRON', 'XRP', 'SOL'] as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="label">{kind === 'report' ? 'What happened? (incident, entity, why this address)' : 'Why is the flag wrong? (what the address is, who controls it)'}</span>
				<textarea class="input" rows="5" bind:value={message} required minlength="10" maxlength="4000"></textarea>
			</label>
			<label class="block">
				<span class="label">Evidence links (transactions, reports, official notices)</span>
				<textarea class="input" rows="3" bind:value={evidence} maxlength="2000"></textarea>
			</label>
			<label class="block">
				<span class="label">Contact (optional — only if you want an answer beyond the status page)</span>
				<input class="input" bind:value={contact} maxlength="200" />
			</label>
			<input class="hp" tabindex="-1" autocomplete="off" bind:value={website} aria-hidden="true" />
			{#if error}<p class="text-sm" style="color: #ef4444;">{error}</p>{/if}
			<button class="btn" type="submit" disabled={busy || !address.trim() || message.trim().length < 10}>{busy ? 'Sending…' : 'Submit'}</button>
			{#if kind === 'appeal'}
				<p class="text-[11px]" style="color: var(--text-faint);">Official sanctions listings (OFAC, UK, EU) can only be removed by the listing authority; Ozone can review traces, community lists and its own flags.</p>
			{/if}
		</form>
	{/if}
</div>

<style>
	.card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
	}
	.tab {
		padding: 6px 12px;
		font-size: 12px;
		border-radius: 8px;
		color: var(--text-muted);
		background: var(--bg-card);
		border: 1px solid var(--app-border);
	}
	.tab.active {
		color: var(--text);
		background: rgba(99, 102, 241, 0.15);
		border-color: var(--app-accent);
	}
	.label {
		display: block;
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 4px;
	}
	.input {
		width: 100%;
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
		outline: none;
	}
	.input:focus {
		border-color: var(--app-accent);
	}
	.btn {
		display: inline-block;
		border-radius: 8px;
		padding: 8px 16px;
		font-size: 13px;
		font-weight: 600;
		color: white;
		background: var(--app-accent);
	}
	.btn:disabled {
		opacity: 0.4;
	}
	.hp {
		position: absolute;
		left: -10000px;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
</style>
