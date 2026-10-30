<script lang="ts">
	// The official Redacted ghost (as on redacted.gg): `solid` fills it with currentColor,
	// `outline` draws it as a line in the brand gradient.
	import { GHOST_PATH, GHOST_VIEWBOX } from './ghost-path';

	let { variant = 'solid', strokeWidth = 1.4 }: { variant?: 'solid' | 'outline'; strokeWidth?: number } = $props();
	const uid = $props.id();
	const id = `ghost-${uid}`;
</script>

{#if variant === 'outline'}
	<svg viewBox="-20 -20 1250 1533" fill="none" aria-hidden="true">
		<defs>
			<linearGradient id={id} x1="0" y1="0" x2="0.6" y2="1">
				<stop offset="0" stop-color="#3bd8cf" />
				<stop offset="0.5" stop-color="#29b4f2" />
				<stop offset="1" stop-color="#1f8ff0" />
			</linearGradient>
		</defs>
		<path d={GHOST_PATH} stroke="url(#{id})" stroke-width={strokeWidth} vector-effect="non-scaling-stroke" />
	</svg>
{:else}
	<svg viewBox={GHOST_VIEWBOX} aria-hidden="true">
		<path d={GHOST_PATH} fill="currentColor" fill-rule="evenodd" />
	</svg>
{/if}
