<script lang="ts">
	import { onMount } from 'svelte';

	let {
		value = 0,
		label = '',
		variant = 'default' as 'default' | 'danger' | 'warning' | 'success',
	}: {
		value: number;
		label: string;
		variant?: 'default' | 'danger' | 'warning' | 'success';
	} = $props();

	let displayed = $state(0);

	const colors = {
		default: '#818cf8',
		danger: '#ef4444',
		warning: '#f59e0b',
		success: '#10b981'
	};

	const borderColors = {
		default: 'rgba(99, 102, 241, 0.2)',
		danger: 'rgba(239, 68, 68, 0.2)',
		warning: 'rgba(245, 158, 11, 0.2)',
		success: 'rgba(16, 185, 129, 0.2)'
	};

	onMount(() => {
		const duration = 1200;
		const start = performance.now();
		const target = value;

		function animate(now: number) {
			const elapsed = now - start;
			const progress = Math.min(elapsed / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			displayed = Math.floor(eased * target);
			if (progress < 1) requestAnimationFrame(animate);
		}

		requestAnimationFrame(animate);
	});
</script>

<div
	class="stats-card rounded-xl p-5 transition-all duration-300"
	style="border: 1px solid {borderColors[variant]};"
>
	<div class="text-3xl font-bold tracking-tight" style="color: {colors[variant]};">
		{displayed.toLocaleString()}
	</div>
	<div class="mt-1 text-sm" style="color: #64748b;">{label}</div>
</div>

<style>
	.stats-card {
		background: #0d0d1f;
	}
	.stats-card:hover {
		background: #13132f;
	}
</style>
