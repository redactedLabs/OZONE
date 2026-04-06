<script lang="ts">
	import { Canvas } from "@threlte/core";
	import BlocksGlobeScene from "./BlocksGlobeScene.svelte";
	import { cn } from "../utils/cn";
	import type { Snippet } from "svelte";
	import type { GlobeMarker, GlobeMarkerTooltipContext } from "./types";
	import { NoToneMapping } from "three";

	interface Props {
		class?: string;
		radius?: number;
		markers?: GlobeMarker[];
		markerTooltip?: Snippet<[GlobeMarkerTooltipContext]>;
		[key: string]: unknown;
	}

	let {
		class: className = "",
		radius = 3,
		markers = [],
		markerTooltip,
		...rest
	}: Props = $props();

	const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
</script>

<div class={cn("relative h-full w-full overflow-hidden", className)} {...rest}>
	<div class="absolute inset-0 z-0">
		<Canvas {dpr} toneMapping={NoToneMapping}>
			<BlocksGlobeScene
				{radius}
				{markers}
				{markerTooltip}
			/>
		</Canvas>
	</div>
</div>
