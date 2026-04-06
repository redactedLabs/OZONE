<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	let GodRaysComponent: any = $state(null);
	let mounted = $state(false);

	onMount(async () => {
		// Handle logout
		const params = new URLSearchParams(window.location.search);
		if (params.get('logout') === '1') {
			await authClient.signOut();
			window.history.replaceState({}, '', '/login');
			window.location.reload();
			return;
		}

		const mod = await import('$lib/motion-core');
		GodRaysComponent = mod.GodRays;
		mounted = true;
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;

		try {
			const result = await authClient.signIn.email({ email, password });
			if (result.error) {
				error = result.error.message || 'Invalid credentials';
				loading = false;
				return;
			}
			// Full reload so layout picks up the new session
			window.location.href = '/';
			return;
		} catch (e: any) {
			error = e?.message || 'Something went wrong';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Login — Ozone</title>
</svelte:head>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden" style="background: var(--bg);">
	{#if mounted && GodRaysComponent}
		<div class="absolute inset-0" style="pointer-events: none;">
			<svelte:component
				this={GodRaysComponent}
				class="h-full w-full"
				color={'#6366f1'}
				backgroundColor={'#060610'}
				intensity={0.25}
				speed={0.5}
				pulsating={true}
				anchorX={0.5}
				anchorY={0.3}
				lightSpread={1.2}
				rayLength={1.5}
			/>
		</div>
	{:else}
		<div class="absolute inset-0" style="background: var(--bg);"></div>
	{/if}

	<div class="relative z-10 w-full max-w-md rounded-2xl p-8 shadow-2xl" style="background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(20px);" data-win-title="Login">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-bold tracking-tight mb-2" style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif; letter-spacing: -0.03em;"><span style="color: var(--text);">Redacted</span><span style="color: var(--text-ghost);">\</span><span style="color: var(--text-faint);">Ozone</span></h1>
			<p class="text-sm" style="color: var(--text-muted);">Admin Login</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div>
				<label for="email" class="mb-1 block text-xs font-medium" style="color: var(--text-muted);">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="admin@redacted.gg"
					required
					class="login-input w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
				/>
			</div>

			<div>
				<label for="password" class="mb-1 block text-xs font-medium" style="color: var(--text-muted);">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					placeholder="Enter password"
					required
					class="login-input w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
				/>
			</div>

			{#if error}
				<div class="rounded-lg p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444;">
					{error}
				</div>
			{/if}

			<button
				type="submit"
				disabled={loading}
				class="login-btn w-full rounded-lg py-2.5 text-sm font-medium text-white transition-all disabled:opacity-50"
			>
				{loading ? 'Signing in...' : 'Sign In'}
			</button>
		</form>

		<p class="mt-6 text-center text-xs" style="color: var(--text-faint);">
			Access is invite-only. Contact the admin to get credentials.
		</p>
	</div>
</div>

<style>
	:global(canvas) {
		background: transparent !important;
	}
	.login-input {
		background: var(--input-bg);
		border: 1px solid var(--input-border);
		color: var(--text);
	}
	.login-input:focus {
		border-color: var(--app-accent);
		box-shadow: 0 0 0 1px var(--app-accent);
	}
	.login-input::placeholder {
		color: var(--text-faint);
	}
	.login-btn {
		background: var(--app-accent);
	}
	.login-btn:hover {
		background: var(--stat-indigo);
		box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
	}
</style>
