<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	let notes = $state<Record<string, string>>({});
	let busy = $state('');
	let message = $state('');

	async function resolve(publicId: string, action: 'accept' | 'reject') {
		busy = publicId;
		const res = await fetch('/api/admin/submissions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ publicId, action, resolution: notes[publicId] ?? '' })
		});
		const body = await res.json();
		message = res.ok ? `${publicId}: ${action}ed. ${body.note ?? ''}` : body.error;
		busy = '';
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Submissions — Ozone admin</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-20 pb-16">
	<h1 class="text-2xl font-bold mb-4" style="color: var(--text);">Reports & appeals</h1>
	<div class="flex gap-2 mb-4">
		{#each ['open', 'accepted', 'rejected'] as s}
			<a href="?status={s}" class="tab" class:active={data.status === s}>{s}</a>
		{/each}
	</div>
	{#if message}<p class="text-sm mb-3" style="color: var(--text-secondary);">{message}</p>{/if}
	{#each data.items as it}
		<div class="card api-card rounded-xl p-4 mb-3" data-win-title={it.public_id}>
			<div class="flex flex-wrap items-center gap-2 mb-1">
				<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background: {it.kind === 'appeal' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: {it.kind === 'appeal' ? '#10b981' : '#ef4444'};">{it.kind}</span>
				<span class="font-mono text-xs" style="color: var(--text);">{it.address}</span>
				<span class="text-[10px]" style="color: var(--text-faint);">{it.chain} · {it.public_id} · {new Date(it.created_at).toLocaleString()}</span>
			</div>
			<p class="text-xs whitespace-pre-wrap mb-1" style="color: var(--text-secondary);">{it.message}</p>
			{#if it.evidence}<p class="text-[11px] whitespace-pre-wrap mb-1" style="color: var(--text-muted);">Evidence: {it.evidence}</p>{/if}
			{#if it.contact}<p class="text-[11px] mb-1" style="color: var(--text-muted);">Contact: {it.contact}</p>{/if}
			{#if it.status === 'open'}
				<div class="flex flex-wrap gap-2 mt-2">
					<input type="text" class="input flex-1" placeholder="Resolution note (public)" bind:value={notes[it.public_id]} />
					<button class="btn" disabled={busy === it.public_id} onclick={() => resolve(it.public_id, 'accept')}>Accept</button>
					<button class="btn-secondary" disabled={busy === it.public_id} onclick={() => resolve(it.public_id, 'reject')}>Reject</button>
				</div>
			{:else}
				<p class="text-[11px]" style="color: var(--text-muted);">{it.status} by {it.resolved_by}: {it.resolution}</p>
			{/if}
		</div>
	{/each}
	{#if data.items.length === 0}<p class="text-sm" style="color: var(--text-muted);">Nothing here.</p>{/if}
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
	.input {
		background: var(--bg-card);
		border: 1px solid var(--app-border);
		color: var(--text);
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 12px;
	}
	.btn {
		border-radius: 8px;
		padding: 6px 14px;
		font-size: 12px;
		font-weight: 600;
		color: white;
		background: var(--app-accent);
	}
	.btn-secondary {
		border-radius: 8px;
		padding: 6px 14px;
		font-size: 12px;
		color: var(--text-muted);
		border: 1px solid var(--app-border);
	}
	/* Win98: the theme recolours inline styles and elements; class-based text needs the same (black on silver). */
	:global(.win98) .tab,
	:global(.win98) .btn-secondary {
		color: #000;
	}
	:global(.win98) a.tab.active.active {
		background: #000080 !important;
		color: #fff !important;
	}
</style>
