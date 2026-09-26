<script lang="ts">
	let { data } = $props();
	const s = $derived(data.submission);
	const color = $derived(s.status === 'accepted' ? '#10b981' : s.status === 'rejected' ? '#ef4444' : '#f59e0b');
</script>

<svelte:head>
	<title>{s.publicId} — Ozone submission</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 pt-20 pb-16">
	<div class="card rounded-2xl p-6" data-win-title="Submission status">
		<div class="text-[10px] font-mono mb-1" style="color: var(--text-faint);">{s.publicId}</div>
		<h1 class="text-xl font-bold mb-3" style="color: var(--text);">{s.kind === 'appeal' ? 'Appeal' : 'Report'}: <span style="color: {color};">{s.status}</span></h1>
		<div class="text-xs font-mono break-all mb-2" style="color: var(--text);">{s.address}{s.chain ? ` (${s.chain})` : ''}</div>
		<div class="text-xs mb-4" style="color: var(--text-muted);">Submitted {new Date(s.createdAt).toLocaleString()}{s.resolvedAt ? ` · resolved ${new Date(s.resolvedAt).toLocaleString()}` : ''}</div>
		{#if s.resolution}
			<p class="text-sm" style="color: var(--text-secondary);">{s.resolution}</p>
		{:else if s.status === 'open'}
			<p class="text-sm" style="color: var(--text-secondary);">Waiting for review.</p>
		{/if}
	</div>
</div>

<style>
	.card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
	}
</style>
