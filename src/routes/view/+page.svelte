<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { parseDeployments, CHAIN_SOURCES } from '$lib/viewkey/config';
	import { ROLE_TEXT, type Banner, type CounterpartyRow, type Label, type ViewModel } from '$lib/viewkey/model';
	import type { HistoryModel } from '$lib/viewkey/model-history';
	import type { Step } from '$lib/viewkey/controller';
	import type { ViewerBridge } from '$lib/viewkey/bridge';
	import type { FileKind } from '$lib/viewkey/config';

	const deployments = parseDeployments(env.PUBLIC_VIEWKEY_DEPLOYMENTS);

	let phase = $state<'idle' | 'working' | 'done' | 'error'>('idle');
	let step = $state<Step>('open');
	let model = $state<ViewModel | HistoryModel | null>(null);
	let error = $state<{ title: string; text: string } | null>(null);
	let pasting = $state(false);
	let pasted = $state('');
	let dragging = $state(false);
	let heroVisible = $state(false);
	let showAllWarnings = $state(false);
	let showNotes = $state(false);
	let deep = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let bridge: ViewerBridge | null = null;
	// the text stays in this tab only (the Worker and this variable), until Close
	let text: string | null = null;
	let kind: FileKind = 'view_key';

	const STEPS: { id: Step; label: string }[] = [
		{ id: 'open', label: 'Opening the file in this browser' },
		{ id: 'chain', label: 'Reading the chain from two sources' },
		{ id: 'payees', label: 'Reading depositors and payees' },
		{ id: 'screen', label: 'Checking counterparties' }
	];
	const stepIndex = $derived(STEPS.findIndex((s) => s.id === step));

	onMount(() => {
		// The page's Content-Security-Policy comes with a full page load: arriving here by an in-app
		// navigation from another page would run without it, so load /view itself.
		const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
		if (nav && new URL(nav.name).pathname !== '/view') {
			location.replace('/view');
			return;
		}
		heroVisible = true;
	});

	onDestroy(() => close());

	const ERRORS: Record<string, { title: string; text: string }> = {
		FILE_TOO_LARGE: { title: 'File too large', text: 'A view key is at most 1 MiB, a history file at most 16 MiB.' },
		FILE_EMPTY: { title: 'Empty file', text: 'Pick or paste a view key or a history file.' },
		FILE_NOT_TEXT: { title: 'Not a view file', text: 'A view key or a history file is one line of JSON.' },
		NOT_A_VIEW_FILE: { title: 'Not a view file', text: 'This is neither a view key nor a history file.' },
		LOOKS_LIKE_A_PHRASE: { title: 'This looks like a recovery phrase', text: 'A view key is never a phrase. Never share a phrase with anyone.' },
		UNKNOWN_DEPLOYMENT: { title: 'Unknown deployment', text: 'This file is for a Redacted deployment Ozone does not read.' },
		NEEDS_SYNC: { title: 'Too early to check', text: 'The chain is not yet past the blocks around this file’s cut. Try again in a few minutes.' },
		WASM_INTEGRITY: { title: 'Client module refused', text: 'The client module does not match its pinned checksum. Reload the page.' },
		VIEWER_START: { title: 'The viewer did not start', text: 'Reload the page and try again.' },
		SOURCES_DISAGREE: { title: 'Sources disagree', text: 'The two chain sources answered differently. Try again in a minute.' },
		CHAIN_MISMATCH: { title: 'Wrong chain', text: 'A chain source serves another chain.' },
		CHAIN_UNAVAILABLE: { title: 'Chain not reachable', text: 'A chain source did not answer. Try again in a minute.' },
		REPLAY: { title: 'Chain read refused', text: 'The chain sources answered an old or inconsistent state. Try again in a minute.' }
	};

	function describe(e: unknown): { title: string; text: string } {
		const err = e as { code?: string; message?: string };
		const code = String(err?.code ?? '');
		const msg = String(err?.message ?? e);
		if (code === 'VIEW_KEY_INVALID' || code === 'HISTORY_INVALID') {
			if (/forbidden secret field/.test(msg)) return { title: 'This file carries a secret', text: 'A view key or history file never does. Do not share this file.' };
			return { title: code === 'HISTORY_INVALID' ? 'Invalid history file' : 'Invalid view key', text: msg.replace(/^(VIEW_KEY|HISTORY)_INVALID:\s*/, '') };
		}
		const known = ERRORS[code];
		if (known) return { title: known.title, text: code.startsWith('CHAIN') || code === 'REPLAY' || code === 'SOURCES_DISAGREE' ? `${known.text} (${msg})` : known.text };
		return { title: 'Could not open the view', text: msg };
	}

	async function openText(t: string) {
		phase = 'working';
		step = 'open';
		error = null;
		model = null;
		try {
			const { checkViewFileText } = await import('$lib/viewkey/file');
			({ text, kind } = checkViewFileText(t));
			await run();
		} catch (e) {
			fail(e);
		}
	}

	async function openFile(f: File | undefined | null) {
		if (!f) return;
		phase = 'working';
		step = 'open';
		error = null;
		model = null;
		try {
			const { readViewFile } = await import('$lib/viewkey/file');
			({ text, kind } = await readViewFile(f));
			await run();
		} catch (e) {
			fail(e);
		} finally {
			if (fileInput) fileInput.value = '';
		}
	}

	async function run() {
		if (!text) return;
		const [{ startViewer }, { runView }] = await Promise.all([import('$lib/viewkey/client'), import('$lib/viewkey/controller')]);
		bridge?.close();
		bridge = await startViewer();
		const out = await runView({ bridge, text, kind, deployments, deep, onStep: (s) => (step = s) });
		model = out.model;
		phase = 'done';
	}

	function fail(e: unknown) {
		error = describe(e);
		phase = 'error';
		bridge?.close();
		bridge = null;
		text = null;
	}

	async function again(withDeep: boolean) {
		if (!text) return;
		deep = withDeep;
		phase = 'working';
		try {
			await run();
		} catch (e) {
			fail(e);
		}
	}

	function close() {
		bridge?.close();
		bridge = null;
		text = null;
		pasted = '';
		model = null;
		error = null;
		deep = false;
		phase = 'idle';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		void openFile(e.dataTransfer?.files?.[0]);
	}

	function short(a: string): string {
		return a.length <= 22 ? a : `${a.slice(0, 11)}…${a.slice(-6)}`;
	}

	const TONE: Record<Label['tone'], string> = {
		ok: 'tone-ok',
		warn: 'tone-warn',
		bad: 'tone-bad',
		muted: 'tone-muted'
	};
</script>

<svelte:head>
	<title>View Key | Ozone</title>
	<meta name="description" content="Open a Redacted view key or history file in your own browser: the account's history, with every counterparty checked against Ozone's lists. The file never leaves your browser." />
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href="https://ozone.redacted.gg/view" />
</svelte:head>

{#snippet bannerList(list: Banner[], warnings: string[], seedNote: string | null)}
		<div class="space-y-2 mb-6" data-testid="banners">
			{#each list as b}
				<div class="vk-banner {TONE[b.tone]} rounded-xl px-4 py-3" role={b.tone === 'bad' ? 'alert' : undefined}>
					<div class="text-sm font-semibold">{b.title}</div>
					<div class="text-xs mt-0.5">{b.text}</div>
				</div>
			{/each}
			{#if seedNote}
				<div class="vk-banner tone-warn rounded-xl px-4 py-2 text-xs" data-testid="seed-note">{seedNote}</div>
			{/if}
			<button type="button" class="vk-link text-xs" onclick={() => (showAllWarnings = !showAllWarnings)}>
				{showAllWarnings ? 'Hide' : 'Show'} the viewer's warnings ({warnings.length})
			</button>
			{#if showAllWarnings}
				<ol class="vk-card rounded-xl p-4 space-y-2 text-xs list-decimal list-inside" data-win-title="Viewer warnings">
					{#each warnings as w}
						<li class="break-words" style="color: var(--text-secondary);">{w}</li>
					{/each}
				</ol>
			{/if}
		</div>

{/snippet}

{#snippet counterpartiesCard(m: { counterparties: CounterpartyRow[]; screening: ViewModel['screening'] })}
		<div class="vk-card rounded-xl p-4 mb-6" data-win-title="Counterparties">
			<div class="flex items-baseline justify-between gap-2 flex-wrap mb-3">
				<h2 class="text-sm font-semibold" style="color: var(--text);">Counterparties</h2>
				<span class="text-[10px] font-mono" style="color: var(--text-faint);">
					{#if m.screening.error}
						Not checked: {m.screening.error}
					{:else if m.screening.snapshot}
						Ozone lists v{m.screening.snapshot.version} &middot; {m.screening.snapshot.builtAt.replace('T', ' ').slice(0, 16)} UTC
					{/if}
				</span>
			</div>
			{#if m.counterparties.length === 0}
				<div class="text-xs" style="color: var(--text-faint);">None</div>
			{/if}
			<div class="divide-y vk-divide">
				{#each m.counterparties as c}
					<div class="py-2.5">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="font-mono text-xs break-all" style="color: var(--text);">{c.address}</div>
								<div class="text-[10px] mt-0.5" style="color: var(--text-faint);">{c.roles.map((r) => ROLE_TEXT[r]).join(' · ')}</div>
							</div>
							<span class="vk-chip {TONE[c.label.tone]} shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold">{c.label.text}</span>
						</div>
						{#each c.reasons as r}
							<div class="text-[11px] mt-1 pl-2 vk-reason" style="color: var(--text-secondary);">
								{r.text} <span style="color: var(--text-faint);">({r.source}, {r.risk})</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>

{/snippet}

<div class="page-shell mx-auto px-4 pt-20 pb-16" class:max-w-3xl={phase !== 'done'} class:max-w-5xl={phase === 'done'}>
	{#if phase !== 'done'}
		<div class="page-hero hero-section text-center mb-10" class:hero-visible={heroVisible}>
			<div class="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 hero-badge">
				<span class="relative inline-flex rounded-full h-2 w-2" style="background: #10b981;"></span>
				<span class="text-[10px] font-mono tracking-wider uppercase" style="color: var(--text-muted);">Read only</span>
			</div>
			<h1 class="hero-title text-4xl sm:text-5xl font-bold tracking-tight mb-4"><span class="hero-gradient">View Key</span></h1>
			<p class="text-base sm:text-lg max-w-2xl mx-auto" style="color: var(--text-muted);">
				Open a Redacted view key or history file to see the account's history, with every counterparty checked against Ozone's lists.
			</p>
		</div>
	{/if}

	{#if phase === 'idle' || phase === 'error'}
		<div class="vk-card rounded-2xl p-6 sm:p-8 max-w-xl mx-auto" data-win-title="Open File">
			{#if !pasting}
				<button
					type="button"
					class="vk-drop rounded-xl w-full px-4 py-8 text-center"
					class:vk-drop-active={dragging}
					onclick={() => fileInput?.click()}
					ondragover={(e) => {
						e.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					ondrop={onDrop}
				>
					<span class="block text-sm font-semibold mb-1" style="color: var(--text);">Choose file</span>
					<span class="block text-xs" style="color: var(--text-faint);">or drop it here</span>
				</button>
				<input bind:this={fileInput} type="file" accept=".json,.txt,application/json,text/plain" class="hidden" onchange={(e) => openFile((e.currentTarget as HTMLInputElement).files?.[0])} />
			{:else}
				<textarea bind:value={pasted} rows="5" spellcheck="false" autocomplete="off" placeholder={'{"version":"hops/v1/view-key",…}  or  {"version":"hops/v1/history",…}'} class="vk-input w-full rounded-xl px-4 py-3 text-xs font-mono"></textarea>
				<button type="button" onclick={() => openText(pasted)} disabled={!pasted.trim()} class="mt-3 w-full rounded-xl px-6 py-3 text-sm font-semibold text-white disabled:opacity-30" style="background: var(--app-accent);">Open</button>
			{/if}
			<div class="flex justify-center mt-3">
				<button type="button" class="vk-link text-xs" onclick={() => (pasting = !pasting)}>{pasting ? 'Choose a file' : 'Paste instead'}</button>
			</div>
			<p class="vk-private text-[11px] mt-4 text-center" style="color: var(--text-muted);">
				The file never leaves this browser. Ozone receives only counterparty addresses.
			</p>
			{#if error}
				<div class="vk-banner tone-bad rounded-xl mt-5 p-4" role="alert">
					<div class="text-sm font-semibold">{error.title}</div>
					<div class="text-xs mt-1 break-words">{error.text}</div>
				</div>
			{/if}
		</div>
	{:else if phase === 'working'}
		<div class="vk-card rounded-2xl p-6 sm:p-8 max-w-xl mx-auto" data-win-title="Reading">
			<div class="space-y-3">
				{#each STEPS as s, i}
					<div class="flex items-center gap-3">
						{#if i < stepIndex}
							<span class="w-4 text-center text-xs" style="color: var(--success);">&#10003;</span>
						{:else if i === stepIndex}
							<span class="scan-spinner"></span>
						{:else}
							<span class="w-4 text-center text-xs" style="color: var(--text-ghost);">&middot;</span>
						{/if}
						<span class="text-sm" style="color: {i <= stepIndex ? 'var(--text)' : 'var(--text-faint)'};">{s.label}</span>
					</div>
				{/each}
			</div>
			<p class="vk-private text-[11px] mt-5 text-center" style="color: var(--text-muted);">
				The file never leaves this browser. Ozone receives only counterparty addresses.
			</p>
		</div>
	{:else if phase === 'done' && model && model.kind === 'view_key'}
		<div class="page-hero page-hero-row flex items-center justify-between gap-3 mb-5 flex-wrap">
			<div>
				<h1 class="text-2xl font-bold" style="color: var(--text);">View Key</h1>
				<div class="text-[11px] font-mono mt-1" style="color: var(--text-faint);">
					{model.summary.fingerprint} &middot; block {model.summary.height.toLocaleString('en-US')}
				</div>
			</div>
			<div class="flex gap-2">
				{#if !deep}
					<button type="button" class="vk-btn rounded-lg px-3 py-1.5 text-xs" onclick={() => again(true)}>Deep scan</button>
				{/if}
				<button type="button" class="vk-btn rounded-lg px-3 py-1.5 text-xs" onclick={close}>Close</button>
			</div>
		</div>

		<!-- Warnings first, always -->
		{@render bannerList(model.banners, model.warnings, null)}

		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
			<div class="vk-card rounded-xl p-4 md:col-span-2" data-win-title="Account">
				<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
					<div style="color: var(--text-faint);">Chain</div>
					<div class="font-mono break-all" style="color: var(--text);">{model.summary.chain}</div>
					<div style="color: var(--text-faint);">Proxy</div>
					<div class="font-mono break-all" style="color: var(--text);" title={model.summary.proxy}>{short(model.summary.proxy)}</div>
					<div style="color: var(--text-faint);">Generations named</div>
					<div class="font-mono" style="color: var(--text);">{model.summary.generations.join(', ')}</div>
					<div style="color: var(--text-faint);">Read from</div>
					<div style="color: var(--text);">{model.summary.sourceNames.join(' + ')}</div>
				</div>
			</div>
			<div class="vk-card rounded-xl p-4" data-win-title="Balances">
				{#if model.balances.length}
					{#each model.balances as b}
						<div class="text-lg font-bold font-mono" style="color: var(--text);">{b.amount}</div>
					{/each}
				{:else}
					<div class="text-sm" style="color: var(--text-faint);">No unspent notes</div>
				{/if}
				<div class="vk-chip tone-bad mt-2 inline-block rounded px-1.5 py-0.5 text-[10px]">Not a proof of funds</div>
			</div>
		</div>

		{@render counterpartiesCard(model)}

		<!-- History -->
		<div class="vk-card rounded-xl p-4 mb-6" data-win-title="History">
			<h2 class="text-sm font-semibold mb-3" style="color: var(--text);">History</h2>
			{#if model.history.length === 0}
				<div class="text-xs" style="color: var(--text-faint);">No activity</div>
			{/if}
			<div class="divide-y vk-divide">
				{#each model.history as h (h.key)}
					<div class="py-2.5 vk-row">
						<div class="vk-row-head">
							<span class="text-sm font-semibold" style="color: var(--text);">{h.title}</span>
							{#if h.amount}<span class="text-sm font-mono" style="color: var(--text);">{h.amount}</span>{/if}
						</div>
						<div class="flex items-center gap-1.5 flex-wrap mt-1">
							{#if h.height !== null}<span class="text-[10px] font-mono" style="color: var(--text-faint);">#{h.height.toLocaleString('en-US')}</span>{/if}
							{#each h.labels as l}
								<span class="vk-chip {TONE[l.tone]} rounded px-1.5 py-0.5 text-[10px]">{l.text}</span>
							{/each}
						</div>
						{#each h.parties as p}
							{@const cl = model.counterparties.find((c) => c.address === p.address)?.label}
							<div class="text-[11px] mt-1" style="color: var(--text-muted);">
								{ROLE_TEXT[p.role]} <span class="font-mono" title={p.address}>{short(p.address)}</span>
								{#if cl}
									<span class="vk-chip {TONE[cl.tone]} rounded px-1 py-0.5 text-[9px] ml-1">{cl.text}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>

		<!-- Spending accounts and exit addresses -->
		{#if model.accounts.length || model.exits.length}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
				<div class="vk-card rounded-xl p-4" data-win-title="Spending accounts">
					<h2 class="text-sm font-semibold mb-3" style="color: var(--text);">Spending accounts</h2>
					{#if model.accounts.length === 0}<div class="text-xs" style="color: var(--text-faint);">None listed</div>{/if}
					{#each model.accounts as a}
						<div class="py-2">
							<div class="flex items-center justify-between gap-2">
								<span class="font-mono text-xs" style="color: var(--text);" title={a.address}>{short(a.address)}</span>
								<span class="text-[10px] font-mono" style="color: var(--text-faint);">#{a.index}</span>
							</div>
							<div class="flex gap-1.5 flex-wrap mt-1">
								{#each a.labels as l}<span class="vk-chip {TONE[l.tone]} rounded px-1.5 py-0.5 text-[10px]">{l.text}</span>{/each}
							</div>
							<div class="text-[11px] mt-1" style="color: var(--text-muted);">
								{a.returns} return{a.returns === 1 ? '' : 's'}{#if a.balances.length} &middot; holds {a.balances.join(', ')}{/if}
							</div>
						</div>
					{/each}
				</div>
				<div class="vk-card rounded-xl p-4" data-win-title="Exit addresses">
					<h2 class="text-sm font-semibold mb-3" style="color: var(--text);">Exit addresses</h2>
					{#if model.exits.length === 0}<div class="text-xs" style="color: var(--text-faint);">None listed</div>{/if}
					{#each model.exits as x}
						<div class="py-2">
							<div class="font-mono text-xs" style="color: var(--text);" title={x.address}>{short(x.address)}</div>
							<div class="flex gap-1.5 flex-wrap mt-1">
								{#each x.labels as l}<span class="vk-chip {TONE[l.tone]} rounded px-1.5 py-0.5 text-[10px]">{l.text}</span>{/each}
								{#if x.balances.length}<span class="text-[11px]" style="color: var(--text-muted);">holds {x.balances.join(', ')}</span>{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Notes -->
		<div class="vk-card rounded-xl p-4 mb-6" data-win-title="Notes">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold" style="color: var(--text);">Notes ({model.notes.length})</h2>
				<button type="button" class="vk-link text-xs" onclick={() => (showNotes = !showNotes)}>{showNotes ? 'Hide' : 'Show'}</button>
			</div>
			{#if showNotes}
				<div class="divide-y vk-divide mt-2">
					{#each model.notes as n (n.key)}
						<div class="py-2 flex items-start justify-between gap-3 flex-wrap">
							<div class="min-w-0">
								<div class="text-xs font-mono" style="color: var(--text);">{n.amount}</div>
								<div class="text-[10px] font-mono" style="color: var(--text-faint);" title={n.cm}>{n.origin} &middot; gen {n.generation}{n.index !== null ? ` · leaf ${n.index}` : ''}</div>
							</div>
							<div class="flex gap-1.5 flex-wrap items-center">
								<span class="text-[10px]" style="color: var(--text-muted);">{n.status}</span>
								{#each n.labels as l}<span class="vk-chip {TONE[l.tone]} rounded px-1.5 py-0.5 text-[10px]">{l.text}</span>{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<p class="vk-private text-[11px] text-center" style="color: var(--text-muted);">
			The view key never leaves this browser. Ozone receives only counterparty addresses.
		</p>
	{:else if phase === 'done' && model && model.kind === 'history'}
		<div class="page-hero page-hero-row flex items-center justify-between gap-3 mb-5 flex-wrap">
			<div>
				<h1 class="text-2xl font-bold" style="color: var(--text);">History File</h1>
				<div class="text-[11px] font-mono mt-1" style="color: var(--text-faint);">
					{model.summary.fingerprint} &middot; cut at block {model.summary.cut.toLocaleString('en-US')}
				</div>
			</div>
			<button type="button" class="vk-btn rounded-lg px-3 py-1.5 text-xs" onclick={close}>Close</button>
		</div>

		<!-- Warnings first, always -->
		{@render bannerList(model.banners, model.warnings, model.seedNote)}

		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
			<div class="vk-card rounded-xl p-4 md:col-span-2" data-win-title="Account">
				<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
					<div style="color: var(--text-faint);">Chain</div>
					<div class="font-mono break-all" style="color: var(--text);">{model.summary.chain}</div>
					<div style="color: var(--text-faint);">Proxy</div>
					<div class="font-mono break-all" style="color: var(--text);" title={model.summary.proxy}>{short(model.summary.proxy)}</div>
					<div style="color: var(--text-faint);">Cut</div>
					<div class="font-mono break-all" style="color: var(--text);" title={model.summary.blockHash}>#{model.summary.cut.toLocaleString('en-US')} &middot; {model.summary.blockHash.slice(0, 12)}…</div>
					<div style="color: var(--text-faint);">Notes listed</div>
					<div style="color: var(--text);">{model.summary.items} &middot; {model.summary.failed ? `${model.summary.failed} failed` : model.summary.verified ? 'all verified' : 'not all verified'}{model.summary.stated ? ` · ${model.summary.stated} stated` : ''}</div>
					<div style="color: var(--text-faint);">Held notes</div>
					<div style="color: var(--text);">{model.summary.heldNullifiers ? 'nullifiers named, checked' : 'nullifiers left out, not checked'}</div>
					<div style="color: var(--text-faint);">Read from</div>
					<div style="color: var(--text);">{model.summary.sourceNames.join(' + ')}</div>
				</div>
			</div>
			<div class="vk-card rounded-xl p-4" data-win-title="At the cut">
				{#if model.totals.length === 0}
					<div class="text-sm" style="color: var(--text-faint);">No verified notes</div>
				{/if}
				{#each model.totals as t}
					<div class="text-lg font-bold font-mono" style="color: var(--text);">{t.held}</div>
					<div class="text-[10px] mb-2" style="color: var(--text-faint);">held at the cut{t.heldConfirmed !== null ? ` · ${t.heldConfirmed} confirmed unspent` : ''}</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
						<span style="color: var(--text-faint);">Deposited</span><span class="font-mono text-right" style="color: var(--text);">{t.deposited}</span>
						<span style="color: var(--text-faint);">Returned</span><span class="font-mono text-right" style="color: var(--text);">{t.returned}</span>
						<span style="color: var(--text-faint);">Gifts</span><span class="font-mono text-right" style="color: var(--text);">{t.gifts}</span>
						<span style="color: var(--text-faint);">Left</span><span class="font-mono text-right" style="color: var(--text);">{t.left}</span>
					</div>
				{/each}
				<div class="vk-chip tone-bad mt-2 inline-block rounded px-1.5 py-0.5 text-[10px]">Not a proof of funds</div>
			</div>
		</div>

		{@render counterpartiesCard(model)}

		<!-- Each listed note with its verdict -->
		<div class="vk-card rounded-xl p-4 mb-6" data-win-title="Notes up to the cut">
			<h2 class="text-sm font-semibold mb-3" style="color: var(--text);">Notes up to the cut</h2>
			{#if model.items.length === 0}
				<div class="text-xs" style="color: var(--text-faint);">The file lists no notes</div>
			{/if}
			<div class="divide-y vk-divide">
				{#each model.items as it (it.key)}
					<div class="py-2.5 vk-row">
						<div class="vk-row-head">
							<span class="text-sm font-semibold" style="color: var(--text);">{it.title}</span>
							<span class="text-sm font-mono" style="color: var(--text);">{it.amount}</span>
						</div>
						<div class="flex items-center gap-1.5 flex-wrap mt-1">
							<span class="text-[10px] font-mono" style="color: var(--text-faint);">leaf {it.index} &middot; #{it.height.toLocaleString('en-US')}</span>
							<span class="vk-chip {TONE[it.verdict.tone]} rounded px-1.5 py-0.5 text-[10px] font-semibold">{it.verdict.text}</span>
							{#each it.labels as l}
								<span class="vk-chip {TONE[l.tone]} rounded px-1.5 py-0.5 text-[10px]">{l.text}</span>
							{/each}
						</div>
						<div class="text-[11px] mt-1" style="color: var(--text-muted);">{it.fate}</div>
						{#each it.parties as p}
							{@const cl = model.counterparties.find((c) => c.address === p.address)?.label}
							<div class="text-[11px] mt-1" style="color: var(--text-muted);">
								{ROLE_TEXT[p.role]} <span class="font-mono" title={p.address}>{short(p.address)}</span>
								{#if cl}
									<span class="vk-chip {TONE[cl.tone]} rounded px-1 py-0.5 text-[9px] ml-1">{cl.text}</span>
								{/if}
							</div>
						{/each}
						{#each it.reasons as r}
							<div class="text-[11px] mt-1 pl-2 vk-reason" style="color: var(--text-secondary);">{r}</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>

		{#if model.accounts.length}
			<div class="vk-card rounded-xl p-4 mb-6" data-win-title="Named addresses">
				<h2 class="text-sm font-semibold mb-3" style="color: var(--text);">Spending accounts and exit addresses</h2>
				{#each model.accounts as a}
					<div class="py-1.5 flex items-center justify-between gap-2 flex-wrap">
						<span class="font-mono text-xs" style="color: var(--text);" title={a.address}>{short(a.address)}</span>
						<span class="flex gap-1.5 items-center">
							<span class="text-[10px]" style="color: var(--text-faint);">{a.kind === 'spending' ? 'Spending account' : 'Exit address'}</span>
							<span class="vk-chip {TONE[a.label.tone]} rounded px-1.5 py-0.5 text-[10px]">{a.label.text}</span>
						</span>
					</div>
				{/each}
			</div>
		{/if}

		<p class="vk-private text-[11px] text-center" style="color: var(--text-muted);">
			The file never leaves this browser. Ozone receives only counterparty addresses.
		</p>
	{/if}
</div>

<style>
	.vk-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		backdrop-filter: blur(8px);
	}
	.vk-drop {
		border: 1px dashed var(--app-border);
		background: var(--bg);
		cursor: pointer;
		transition: border-color 0.15s ease;
	}
	.vk-drop:hover,
	.vk-drop-active {
		border-color: var(--app-accent);
	}
	.vk-input {
		background: var(--bg);
		border: 1px solid var(--app-border);
		color: var(--text);
		outline: none;
		resize: vertical;
	}
	.vk-input:focus {
		border-color: var(--app-accent);
	}
	.vk-input::placeholder {
		color: var(--text-faint);
	}
	.vk-link {
		color: var(--app-accent);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.vk-btn {
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
	}
	.vk-btn:hover {
		border-color: var(--app-accent);
	}
	.vk-divide > :global(* + *) {
		border-top: 1px solid var(--app-border-subtle);
	}
	.vk-row-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.vk-reason {
		border-left: 2px solid var(--danger);
	}
	.vk-banner {
		border: 1px solid;
	}
	.vk-chip {
		border: 1px solid;
		white-space: nowrap;
	}
	.tone-bad {
		color: #fca5a5;
		background: rgba(239, 68, 68, 0.08);
		border-color: rgba(239, 68, 68, 0.35);
	}
	.tone-warn {
		color: #fcd34d;
		background: rgba(245, 158, 11, 0.08);
		border-color: rgba(245, 158, 11, 0.35);
	}
	.tone-ok {
		color: #6ee7b7;
		background: rgba(16, 185, 129, 0.08);
		border-color: rgba(16, 185, 129, 0.3);
	}
	.tone-muted {
		color: var(--text-secondary);
		background: transparent;
		border-color: var(--app-border);
	}
	:global(.win98) .tone-bad {
		color: #800000 !important;
		background: #ffffff !important;
		border-color: #800000 !important;
	}
	:global(.win98) .tone-warn {
		color: #000000 !important;
		background: #ffffe1 !important;
		border-color: #808080 !important;
	}
	:global(.win98) .tone-ok {
		color: #006000 !important;
		background: #ffffff !important;
		border-color: #808080 !important;
	}
	:global(.win98) .tone-muted {
		color: #000000 !important;
		background: transparent !important;
		border-color: #808080 !important;
	}
	:global(.win98) .vk-drop {
		background: #ffffff !important;
		border: 2px solid !important;
		border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
	}
	:global(.win98) .vk-input {
		background: #ffffff !important;
		color: #000000 !important;
		border: 2px solid !important;
		border-color: #808080 #dfdfdf #dfdfdf #808080 !important;
	}
	:global(.win98) .vk-btn {
		background: #c0c0c0 !important;
		color: #000000 !important;
		border: 2px solid !important;
		border-color: #dfdfdf #0a0a0a #0a0a0a #dfdfdf !important;
	}
	:global(.win98) .vk-link {
		color: #000080 !important;
	}
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
		to {
			transform: rotate(360deg);
		}
	}
	.hero-section {
		opacity: 0;
		transform: translateY(12px);
		transition:
			opacity 0.6s ease,
			transform 0.6s ease;
	}
	.hero-section.hero-visible {
		opacity: 1;
		transform: translateY(0);
	}
	.hero-title {
		color: var(--text);
	}
	.hero-badge {
		background: rgba(16, 185, 129, 0.08);
		border: 1px solid rgba(16, 185, 129, 0.15);
	}
	.hero-gradient {
		background: linear-gradient(135deg, #10b981, #6366f1, #a78bfa);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
</style>
