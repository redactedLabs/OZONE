<script lang="ts">
	import { onMount } from 'svelte';

	const tips = [
		"It looks like you're checking compliance! Need to screen a wallet? Try the Wallet Explorer!",
		"Did you know? Ozone screens against OFAC, EU sanctions, Tether frozen lists, and more — all free!",
		"Want a Proof of Innocence? Get a verifiable compliance certificate for any THORChain address!",
		"Hey! You can export your full transaction history as CSV. Perfect for tax season!",
		"Trade privately on Rujira! Check out the Redacted Dashboard to learn how.",
		"Ozone API is free — no auth required. One endpoint, every sanctions list. Check the docs!",
		"I see you're using Ozone! Fun fact: we monitor wallets across all of THORChain.",
		"Fun fact: Ozone auto-syncs compliance lists every 30 minutes. Always up to date!",
		"Need to check an address? The API is just /api/screen?address=thor1... — try it!",
		"Contribute to compliance! Submit flagged addresses on our Open Source page.",
	];

	// Idle animation frames from clippyjs agent.ts (sprite coords at 124x93 per frame)
	const idleFrames = [
		{ x: 0, y: 0, dur: 1000 },
		{ x: 0, y: 93, dur: 100 },
		{ x: 124, y: 93, dur: 100 },
		{ x: 248, y: 93, dur: 100 },
		{ x: 372, y: 93, dur: 100 },
		{ x: 0, y: 0, dur: 100 },
	];

	let position = $state({ x: 0, y: 0 });
	let dragging = $state(false);
	let currentTip = $state(0);
	let showBubble = $state(true);
	let dismissed = $state(false);
	let spriteX = $state(0);
	let spriteY = $state(0);
	let dragOffset = { x: 0, y: 0 };
	let tipInterval: ReturnType<typeof setInterval>;
	let animTimeout: ReturnType<typeof setTimeout>;

	function nextTip() {
		currentTip = (currentTip + 1) % tips.length;
	}

	function resetTipInterval() {
		clearInterval(tipInterval);
		tipInterval = setInterval(nextTip, 8000);
	}

	function playIdle() {
		let i = 0;
		function step() {
			if (i >= idleFrames.length) {
				spriteX = 0;
				spriteY = 0;
				// Play idle again after 3-6 seconds
				animTimeout = setTimeout(playIdle, 3000 + Math.random() * 3000);
				return;
			}
			spriteX = idleFrames[i].x;
			spriteY = idleFrames[i].y;
			const dur = idleFrames[i].dur;
			i++;
			animTimeout = setTimeout(step, dur);
		}
		step();
	}

	function onBodyClick() {
		if (dragging) return;
		if (!showBubble) {
			showBubble = true;
		}
		nextTip();
		resetTipInterval();
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		dragOffset.x = e.clientX - position.x;
		dragOffset.y = e.clientY - position.y;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const maxX = window.innerWidth - 130;
		const maxY = window.innerHeight - 100;
		position.x = Math.max(0, Math.min(maxX, e.clientX - dragOffset.x));
		position.y = Math.max(0, Math.min(maxY, e.clientY - dragOffset.y));
	}

	function onPointerUp() {
		dragging = false;
	}

	onMount(() => {
		position.x = window.innerWidth - 160;
		position.y = window.innerHeight - 130;

		tipInterval = setInterval(nextTip, 8000);
		animTimeout = setTimeout(playIdle, 2000);

		return () => {
			clearInterval(tipInterval);
			clearTimeout(animTimeout);
		};
	});
</script>

{#if !dismissed}
	<div
		class="clippy-wrap"
		style="position: fixed; left: {position.x}px; top: {position.y}px; z-index: 9999; touch-action: none; user-select: none;"
	>
		<!-- Speech bubble -->
		{#if showBubble}
			<div class="clippy-bubble">
				<button class="clippy-btn clippy-bubble-close" onclick={() => { showBubble = false; }}>x</button>
				<div class="clippy-bubble-text">{tips[currentTip]}</div>
				<div class="clippy-bubble-tail"></div>
			</div>
		{/if}

		<!-- Clippy body (sprite) -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="clippy-body"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onclick={onBodyClick}
			style="cursor: {dragging ? 'grabbing' : 'grab'};"
		>
			<div
				class="clippy-sprite"
				style="background-position: -{spriteX}px -{spriteY}px;"
			></div>

			<!-- Dismiss X -->
			<button class="clippy-btn clippy-dismiss" onclick={(e) => { e.stopPropagation(); dismissed = true; }}>x</button>
		</div>
	</div>
{/if}

<style>
	.clippy-wrap {
		pointer-events: auto;
	}

	.clippy-body {
		position: relative;
		width: 124px;
		height: 93px;
	}

	.clippy-sprite {
		width: 124px;
		height: 93px;
		background-image: url('/clippy-sprite.png');
		background-repeat: no-repeat;
		image-rendering: auto;
	}

	/* Shared tiny Win98 button — overrides global .win98 button rules */
	.clippy-btn {
		background: #c0c0c0 !important;
		border: 2px solid !important;
		border-color: #dfdfdf #0a0a0a #0a0a0a #dfdfdf !important;
		border-radius: 0 !important;
		font-family: 'Pixelated MS Sans Serif', 'MS Sans Serif', Tahoma, sans-serif !important;
		color: #000 !important;
		cursor: pointer;
		display: flex !important;
		align-items: center !important;
		justify-content: center !important;
		padding: 0 !important;
		min-width: 0 !important;
		width: auto !important;
		max-width: none !important;
		line-height: 1;
		box-shadow: none !important;
		text-shadow: none !important;
	}

	.clippy-btn:active {
		border-color: #0a0a0a #dfdfdf #dfdfdf #0a0a0a !important;
	}

	.clippy-dismiss {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 16px !important;
		height: 16px !important;
		font-size: 9px;
	}

	/* Speech bubble */
	.clippy-bubble {
		position: absolute;
		bottom: calc(100% + 8px);
		right: 0;
		width: 240px;
		background: #ffffe1;
		border: 1px solid #000000;
		box-shadow: 2px 2px 0 #808080;
		padding: 8px 22px 8px 8px;
		font-family: 'Pixelated MS Sans Serif', 'MS Sans Serif', Tahoma, sans-serif;
		font-size: 11px;
		color: #000000;
		line-height: 1.4;
		-webkit-font-smoothing: none;
	}

	.clippy-bubble-tail {
		position: absolute;
		bottom: -6px;
		right: 24px;
		width: 0;
		height: 0;
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-top: 6px solid #000000;
	}
	.clippy-bubble-tail::after {
		content: '';
		position: absolute;
		bottom: 1px;
		left: -5px;
		width: 0;
		height: 0;
		border-left: 5px solid transparent;
		border-right: 5px solid transparent;
		border-top: 5px solid #ffffe1;
	}

	.clippy-bubble-close {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 14px !important;
		height: 14px !important;
		font-size: 8px;
	}

	.clippy-bubble-text {
		word-wrap: break-word;
	}
</style>
