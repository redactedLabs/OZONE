<script lang="ts">
	let {
		message = '',
		variant = 'info' as 'info' | 'success' | 'error' | 'warning',
		visible = false,
		onclose = () => {}
	}: {
		message: string;
		variant?: 'info' | 'success' | 'error' | 'warning';
		visible: boolean;
		onclose?: () => void;
	} = $props();

	const variantStyles = {
		info: 'border-[var(--app-accent)]/30 bg-[var(--app-accent)]/10',
		success: 'border-[var(--success)]/30 bg-[var(--success)]/10',
		error: 'border-[var(--danger)]/30 bg-[var(--danger)]/10',
		warning: 'border-[var(--warning)]/30 bg-[var(--warning)]/10'
	};

	const icons = {
		info: 'i',
		success: '\u2713',
		error: '\u2717',
		warning: '!'
	};

	$effect(() => {
		if (visible) {
			const timer = setTimeout(() => {
				onclose();
			}, 5000);
			return () => clearTimeout(timer);
		}
	});
</script>

{#if visible}
	<div
		class="fixed right-4 bottom-4 z-50 animate-slide-in rounded-lg border p-4 shadow-lg backdrop-blur-sm {variantStyles[variant]}"
	>
		<div class="flex items-center gap-3">
			<span class="text-lg font-bold">{icons[variant]}</span>
			<span class="text-sm text-[var(--text)]">{message}</span>
			<button
				onclick={onclose}
				class="ml-4 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
			>
				&times;
			</button>
		</div>
	</div>
{/if}

<style>
	@keyframes slide-in {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.animate-slide-in {
		animation: slide-in 0.3s ease-out;
	}
</style>
