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
	const isOwner = $derived(data?.user?.role === 'owner');
	const toggleTheme = () => theme.toggle();

	const menuGroups = $derived([
		{
			title: 'Public Tools',
			variant: 'muted' as const,
			links: [
				{ label: 'Wallet Explorer', href: '/history' },
				{ label: 'Proof of Innocence', href: '/certificate' },
				{ label: 'Redacted Dashboard', href: '/privacy' },
			]
		},
		{
			title: 'Compliance',
			variant: 'default' as const,
			links: [
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
				...(isAdmin ? [{ label: 'Compliance Lists', href: '/admin/lists' }] : []),
				...(isAdmin ? [{ label: 'Settings', href: '/admin/settings' }] : []),
				...(isOwner ? [{ label: 'Live Logs', href: '/admin/logs' }] : []),
				...(isOwner ? [{ label: 'Sync', href: '/admin/sync' }] : []),
				...(isAdmin
					? [{ label: 'Logout', href: '/login?logout=1' }]
					: [{ label: 'Login', href: '/login' }]
				),
			]
		},
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
		<a href="/" class="logo-link" style="display: flex; align-items: center; text-decoration: none; gap: 0;">
			<img src="/redacted-logo.svg" alt="Redacted" style="height: 22px; width: auto; opacity: 0.9;" />
			<span class="logo-ozone" style="font-weight: bold; font-size: 14px; color: var(--text-muted); margin-left: 1px;">\OZONE</span>
		</a>
		{#if isAdmin && data?.user?.email}
			<span class="hidden sm:inline rounded px-1.5 py-0.5 text-[9px] font-medium" style="background: rgba(99,102,241,0.15); color: var(--app-accent);">{data.user.email}</span>
		{/if}
		<button onclick={toggleTheme} class="win98-toggle" title="Toggle Win98 mode">
			{theme.current === 'win98' ? 'Modern' : 'Win98'}
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

	<footer class="site-footer">
		<div class="footer-inner">
			<div class="footer-brand">
				<a href="/" class="footer-logo">
					<img src="/redacted-logo.svg" alt="Redacted" style="height: 16px; width: auto; opacity: 0.6;" />
					<span style="font-weight: bold; font-size: 11px; color: var(--text-faint); margin-left: 1px;">\OZONE</span>
				</a>
				<span class="footer-copy" style="color: var(--text-ghost);">On-chain compliance for THORChain & Rujira</span>
			</div>
			<div class="footer-links">
				<a href="https://x.com/redacted_money" target="_blank" rel="noopener">X / Twitter</a>
				<a href="https://docs.redacted.money" target="_blank" rel="noopener">Docs</a>
				<a href="https://rujira.network" target="_blank" rel="noopener">Rujira</a>
				<a href="https://thorchain.org" target="_blank" rel="noopener">THORChain</a>
			</div>
		</div>
	</footer>
</div>

<style>
	:global(html), :global(body) {
		background-color: var(--bg) !important;
		color: var(--text) !important;
	}

	.site-footer {
		margin-top: 4rem;
		padding: 2rem 1.5rem;
		border-top: 1px solid var(--app-border);
	}
	.footer-inner {
		max-width: 72rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.footer-brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.footer-logo {
		display: flex;
		align-items: center;
		text-decoration: none;
		gap: 0;
	}
	.footer-copy {
		font-size: 10px;
	}
	.footer-links {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
	}
	.footer-links a {
		font-size: 11px;
		color: var(--text-faint);
		text-decoration: none;
		transition: color 0.15s;
	}
	.footer-links a:hover {
		color: var(--text);
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
