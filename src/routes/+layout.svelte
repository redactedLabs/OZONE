<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { theme } from '$lib/stores/theme.svelte';
	import Ghost from '$lib/components/Ghost.svelte';

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
				{ label: 'View Key', href: '/view' },
				{ label: 'Redacted Dashboard', href: '/privacy' },
			]
		},
		{
			title: 'Compliance',
			variant: 'default' as const,
			links: [
				{ label: 'Addresses', href: '/addresses' },
				{ label: 'Flagged Addresses', href: '/flagged' },
				{ label: 'Listed Addresses', href: '/banned' },
				{ label: 'Monitored Accounts', href: '/screening' },
				{ label: 'Methodology', href: '/methodology' },
				{ label: 'Report / Appeal', href: '/submit' },
			]
		},
		{
			title: 'Contributors',
			variant: 'default' as const,
			links: [
				{ label: 'Open Source', href: '/open-source' },
				{ label: 'API', href: '/api-docs' },
				...(isAdmin ? [{ label: 'Compliance Lists', href: '/admin/lists' }] : []),
				...(isAdmin ? [{ label: 'Reports & Appeals', href: '/admin/submissions' }] : []),
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

	// the Redacted footer: the menu's public pages, and where Redacted lives
	const footerCols = [
		{ title: 'Tools', links: [
			{ label: 'Wallet Explorer', href: '/history' },
			{ label: 'Proof of Innocence', href: '/certificate' },
			{ label: 'View Key', href: '/view' },
			{ label: 'Redacted Dashboard', href: '/privacy' },
		] },
		{ title: 'Compliance', links: [
			{ label: 'Flagged Addresses', href: '/flagged' },
			{ label: 'Listed Addresses', href: '/banned' },
			{ label: 'Monitored Accounts', href: '/screening' },
			{ label: 'Methodology', href: '/methodology' },
			{ label: 'Report / Appeal', href: '/submit' },
		] },
		{ title: 'Contributors', links: [
			{ label: 'Open Source', href: '/open-source' },
			{ label: 'API', href: '/api-docs' },
			{ label: 'GitHub', href: 'https://github.com/redactedLabs/OZONE' },
		] },
		{ title: 'Redacted', links: [
			{ label: 'redacted.gg', href: 'https://redacted.gg' },
			{ label: 'Docs', href: 'https://docs.redacted.money' },
			{ label: 'Rujira', href: 'https://rujira.network' },
			{ label: 'THORChain', href: 'https://thorchain.org' },
		] },
	];

	onMount(() => {
		theme.apply();

		import('$lib/motion-core').then((mod) => {
			FloatingMenuComponent = mod.FloatingMenu;
			mounted = true;
		});
	});
</script>

{#snippet logo()}
	<div class="w98-only flex items-center gap-2">
		<a href="/" class="logo-link" style="display: flex; align-items: center; text-decoration: none; gap: 0;">
			<img src="/redacted-logo.svg" alt="Redacted" style="height: 22px; width: auto; opacity: 0.9;" />
			<span class="logo-ozone" style="font-weight: bold; font-size: 14px; color: var(--text-muted); margin-left: 1px;">\OZONE</span>
		</a>
		{#if isAdmin && data?.user?.email}
			<span class="hidden sm:inline rounded px-1.5 py-0.5 text-[9px] font-medium" style="background: rgba(99,102,241,0.15); color: var(--app-accent);">{data.user.email}</span>
		{/if}
		<button onclick={toggleTheme} class="win98-toggle" title="Switch to the Redacted look">Modern</button>
	</div>
	<div class="rd-only flex min-w-0 flex-1 items-center gap-2">
		<a href="/" class="rd-logo" aria-label="Ozone home">
			<span class="rd-tile"><Ghost /></span>
			<span class="rd-wordmark">Ozone</span>
		</a>
		<nav class="rd-navlinks" aria-label="Main">
			<a href="/history">Explorer</a>
			<a href="/flagged">Flagged</a>
			<a href="/methodology">Methodology</a>
			<a href="/api-docs">API</a>
		</nav>
	</div>
{/snippet}

<!-- The Redacted theme's look switch, at the bottom of the opened menu (the Win98 bar has its own button) -->
{#snippet menuFooter()}
	<span class="rd-only">{isAdmin && data?.user?.email ? `Signed in as ${data.user.email}` : 'Look'}</span>
	<div class="rd-only theme-choice" role="group" aria-label="Look">
		<button type="button" aria-pressed={theme.current === 'redacted'} onclick={() => theme.current !== 'redacted' && toggleTheme()}>Redacted</button>
		<button type="button" aria-pressed={theme.current === 'win98'} onclick={() => theme.current !== 'win98' && toggleTheme()}>Windows 98</button>
	</div>
{/snippet}

<div class="site-root min-h-screen" style="background: var(--bg);">
	{#if mounted && FloatingMenuComponent}
		<svelte:component
			this={FloatingMenuComponent}
			menuGroups={menuGroups}
			{logo}
			{menuFooter}
			primaryButton={isAdmin ? { label: 'Admin Lists', href: '/admin/lists' } : theme.current === 'redacted' ? { label: 'Check address', href: '/certificate' } : undefined}
		/>
	{/if}

	<main class="relative">
		{@render children()}
	</main>

	<footer class="site-footer w98-only">
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

	<footer class="rd-footer rd-only">
		<div class="rd-footer-ghost" aria-hidden="true"><Ghost variant="outline" /></div>
		<div class="rd-footer-grid">
			<div class="rd-footer-brand">
				<a href="/" class="rd-logo">
					<span class="rd-tile"><Ghost /></span>
					<span class="rd-wordmark">Ozone <span>by Redacted</span></span>
				</a>
				<p class="rd-footer-about">On-chain compliance for THORChain & Rujira. Open source, free to use.</p>
				<div class="rd-footer-socials">
					<a href="https://x.com/redacted_money" target="_blank" rel="noopener" aria-label="X">
						<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M13.7 3h2.5l-5.4 6.2L17 17h-5l-3.9-5.1L3.6 17H1.1l5.8-6.6L1 3h5.1l3.5 4.7L13.7 3Zm-.9 12.6h1.4L5.3 4.3H3.8l9 11.3Z" /></svg>
					</a>
					<a href="https://github.com/redactedLabs/OZONE" target="_blank" rel="noopener" aria-label="GitHub">
						<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
					</a>
				</div>
			</div>
			{#each footerCols as col (col.title)}
				<div>
					<h3>{col.title}</h3>
					<ul>
						{#each col.links as l (l.href)}
							<li><a href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel={l.href.startsWith('http') ? 'noopener' : undefined}>{l.label}</a></li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
		<div class="rd-footer-bottom">
			<span>© {new Date().getFullYear()} Redacted</span>
			<span>Every list and every rule is public.</span>
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
