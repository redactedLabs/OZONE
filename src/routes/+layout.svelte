<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { theme } from '$lib/stores/theme.svelte';

	let { children, data } = $props();

	let FloatingMenuComponent: any = $state(null);
	let mounted = $state(false);

	const isAdmin = $derived(!!data?.user);
	const toggleTheme = () => theme.toggle();

	const menuGroups = $derived([
		{
			title: 'Public Tools',
			variant: 'muted' as const,
			links: [
				{ label: 'Wallet Explorer', href: '/history' },
				{ label: 'Proof of Innocence', href: '/certificate' },
			]
		},
		{
			title: 'Compliance',
			variant: 'default' as const,
			links: [
				{ label: 'Overview', href: '/' },
				{ label: 'Addresses', href: '/addresses' },
				{ label: 'Sanctioned List', href: '/banned' },
			]
		},
		{
			title: 'Contributors',
			variant: 'default' as const,
			links: [
				{ label: 'Open Source', href: '/open-source' },
				{ label: 'API', href: '/api-docs' },
				...(isAdmin
					? [{ label: 'Logout', href: '/login?logout=1' }]
					: [{ label: 'Login', href: '/login' }]
				),
			]
		},
		...(isAdmin ? [{
			title: 'Admin',
			variant: 'default' as const,
			links: [
				{ label: 'Compliance Lists', href: '/admin/lists' },
				{ label: 'Live Logs', href: '/admin/logs' },
				{ label: 'Settings', href: '/admin/settings' },
			]
		}] : []),
	]);

	onMount(() => {
		theme.apply();

		import('$lib/motion-core').then((mod) => {
			FloatingMenuComponent = mod.FloatingMenu;
			mounted = true;
		});
	});
</script>

{#snippet logo()}
	<div class="flex items-center gap-2">
		<img src="/redacted-logo.svg" alt="Redacted" style="height: 22px; width: auto; opacity: 0.9;" />
		{#if isAdmin && data?.user?.email}
			<span class="hidden sm:inline rounded px-1.5 py-0.5 text-[9px] font-medium" style="background: rgba(99,102,241,0.15); color: var(--app-accent);">{data.user.email}</span>
		{/if}
		<button onclick={toggleTheme} class="win98-toggle" title="Toggle Win98 mode">
			{theme.current === 'win98' ? '🌙' : '98'}
		</button>
	</div>
{/snippet}

<div class="min-h-screen" style="background: var(--bg);">
	{#if mounted && FloatingMenuComponent}
		<svelte:component
			this={FloatingMenuComponent}
			menuGroups={menuGroups}
			{logo}
			primaryButton={isAdmin ? { label: 'Admin Lists', href: '/admin/lists' } : undefined}
		/>
	{/if}

	<main class="relative">
		{@render children()}
	</main>
</div>

<style>
	:global(html), :global(body) {
		background-color: var(--bg) !important;
		color: var(--text) !important;
	}

	.win98-toggle {
		font-size: 10px;
		padding: 1px 6px;
		border: 1px solid var(--app-border);
		border-radius: 3px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-weight: bold;
		min-width: auto !important;
	}
</style>
