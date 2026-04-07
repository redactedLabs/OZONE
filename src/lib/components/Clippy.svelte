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

	let position = $state({ x: 0, y: 0 });
	let dragging = $state(false);
	let currentTip = $state(0);
	let showBubble = $state(true);
	let dismissed = $state(false);
	let blinking = $state(false);
	let dragOffset = { x: 0, y: 0 };
	let tipInterval: ReturnType<typeof setInterval>;
	let blinkInterval: ReturnType<typeof setInterval>;

	function nextTip() {
		currentTip = (currentTip + 1) % tips.length;
	}

	function resetTipInterval() {
		clearInterval(tipInterval);
		tipInterval = setInterval(nextTip, 8000);
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
		const maxX = window.innerWidth - 80;
		const maxY = window.innerHeight - 100;
		position.x = Math.max(0, Math.min(maxX, e.clientX - dragOffset.x));
		position.y = Math.max(0, Math.min(maxY, e.clientY - dragOffset.y));
	}

	function onPointerUp() {
		dragging = false;
	}

	onMount(() => {
		position.x = window.innerWidth - 112;
		position.y = window.innerHeight - 132;

		tipInterval = setInterval(nextTip, 8000);

		blinkInterval = setInterval(() => {
			blinking = true;
			setTimeout(() => { blinking = false; }, 150);
		}, 4000);

		return () => {
			clearInterval(tipInterval);
			clearInterval(blinkInterval);
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
				<button class="clippy-bubble-close" onclick={() => { showBubble = false; }}>x</button>
				<div class="clippy-bubble-text">{tips[currentTip]}</div>
				<div class="clippy-bubble-tail"></div>
			</div>
		{/if}

		<!-- Clippy body -->
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
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80" width="60" height="80">
				<!-- Wire body -->
				<path d="M30 75 C30 75, 18 65, 18 50 C18 38, 22 30, 28 22 C32 16, 38 14, 40 20 C42 26, 38 34, 34 40 C30 46, 26 52, 26 58 C26 62, 28 65, 30 65"
					fill="none" stroke="#808080" stroke-width="3.5" stroke-linecap="round"/>
				<path d="M30 75 C30 75, 42 65, 42 50 C42 38, 38 30, 32 22 C28 16, 22 14, 20 20 C18 26, 22 34, 26 40 C30 46, 34 52, 34 58 C34 62, 32 65, 30 65"
					fill="none" stroke="#b0b0b0" stroke-width="3.5" stroke-linecap="round"/>

				<!-- Highlight on wire -->
				<path d="M24 35 C26 28, 30 22, 34 20"
					fill="none" stroke="#d8d8d8" stroke-width="1.5" stroke-linecap="round"/>

				<!-- Left eye -->
				<ellipse cx="24" cy="14" rx="7" ry="8" fill="white" stroke="#333" stroke-width="1.5"/>
				<circle cx="25" cy="14" r="3" fill="#000" class={blinking ? 'blink' : ''}/>
				<circle cx="26" cy="13" r="1" fill="#fff"/>

				<!-- Right eye -->
				<ellipse cx="38" cy="14" rx="7" ry="8" fill="white" stroke="#333" stroke-width="1.5"/>
				<circle cx="39" cy="14" r="3" fill="#000" class={blinking ? 'blink' : ''}/>
				<circle cx="40" cy="13" r="1" fill="#fff"/>

				<!-- Left eyebrow (raised) -->
				<path d="M17 5 C20 2, 26 3, 28 5" fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>

				<!-- Right eyebrow -->
				<path d="M33 5 C35 3, 41 3, 43 6" fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
			</svg>

			<!-- Dismiss X -->
			<button class="clippy-dismiss" onclick={(e) => { e.stopPropagation(); dismissed = true; }}>x</button>
		</div>
	</div>
{/if}

<style>
	.clippy-wrap {
		pointer-events: auto;
	}

	.clippy-body {
		position: relative;
		width: 60px;
		height: 80px;
	}

	.clippy-body:hover svg path[stroke="#808080"] {
		stroke: #909090;
	}

	.clippy-dismiss {
		position: absolute;
		top: -4px;
		right: -8px;
		width: 16px;
		height: 16px;
		background: #c0c0c0;
		border: 2px solid;
		border-color: #dfdfdf #0a0a0a #0a0a0a #dfdfdf;
		font-size: 9px;
		font-family: 'Pixelated MS Sans Serif', 'MS Sans Serif', Tahoma, sans-serif;
		color: #000;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		line-height: 1;
	}

	.clippy-dismiss:active {
		border-color: #0a0a0a #dfdfdf #dfdfdf #0a0a0a;
	}

	/* Speech bubble */
	.clippy-bubble {
		position: absolute;
		bottom: calc(100% + 8px);
		right: 0;
		width: 220px;
		background: #ffffe1;
		border: 1px solid #000000;
		box-shadow: 2px 2px 0 #808080;
		padding: 8px 20px 8px 8px;
		font-family: 'Pixelated MS Sans Serif', 'MS Sans Serif', Tahoma, sans-serif;
		font-size: 11px;
		color: #000000;
		line-height: 1.4;
		-webkit-font-smoothing: none;
	}

	.clippy-bubble-tail {
		position: absolute;
		bottom: -6px;
		right: 20px;
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
		width: 14px;
		height: 14px;
		background: #c0c0c0;
		border: 2px solid;
		border-color: #dfdfdf #0a0a0a #0a0a0a #dfdfdf;
		font-size: 8px;
		font-family: 'Pixelated MS Sans Serif', 'MS Sans Serif', Tahoma, sans-serif;
		color: #000;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		line-height: 1;
	}

	.clippy-bubble-close:active {
		border-color: #0a0a0a #dfdfdf #dfdfdf #0a0a0a;
	}

	.clippy-bubble-text {
		word-wrap: break-word;
	}

	/* Blink animation */
	:global(.blink) {
		opacity: 0;
	}
</style>
