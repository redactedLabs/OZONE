<script lang="ts">
	import { onMount } from 'svelte';

	type Frame = { x: number; y: number; dur: number };

	const tips = [
		// Tax / Koinly / Export (heavily weighted)
		"Tax season? Export your full THORChain history as Koinly-compatible CSV — one click in the Wallet Explorer!",
		"Did you know? Ozone generates Koinly-ready CSVs. Swaps, LPs, sends — all labeled. Your tax consultant will love you.",
		"Need a tax report? Enter your thor address in the Wallet Explorer, hit Export, and import straight into Koinly!",
		"Hey! Your THORChain swaps, LP adds, and withdrawals are all exportable. Koinly, CoinTracker, or raw CSV — we got you.",
		"Pro tip: Export your transaction history BEFORE tax deadline. Ozone pulls every swap, send, and LP action automatically.",
		"I see you're using THORChain! Don't forget — you can export your full tx history as CSV for tax reporting anytime.",
		"Fun fact: Ozone labels every transaction type — swaps, streams, LPs, refunds. Perfect for Koinly import!",
		// Compliance
		"It looks like you're checking compliance! Need to screen a wallet? Try the Wallet Explorer!",
		"Did you know? Ozone screens against OFAC, EU sanctions, Tether frozen lists, and more — all free!",
		"Want a Proof of Innocence? Get a verifiable compliance certificate for any THORChain address!",
		// Features
		"Trade privately on Rujira! Check out the Redacted Dashboard to learn how.",
		"Ozone API is free — no auth required. One endpoint, every sanctions list. Check the docs!",
		"Fun fact: Ozone auto-syncs compliance lists every 30 minutes. Always up to date!",
		"Need to check an address? The API is just /api/screen?address=thor1... — try it!",
		"Contribute to compliance! Submit flagged addresses on our Open Source page.",
	];

	// Animations from clippyjs sprite sheet (124x93 per frame)
	const animations: Record<string, Frame[]> = {
		Wave: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 1116, y: 1767, dur: 100 }, { x: 1240, y: 1767, dur: 100 },
			{ x: 1364, y: 1767, dur: 100 }, { x: 1488, y: 1767, dur: 100 },
			{ x: 1612, y: 1767, dur: 100 }, { x: 1736, y: 1767, dur: 100 },
			{ x: 1860, y: 1767, dur: 100 }, { x: 1984, y: 1767, dur: 100 },
			{ x: 2108, y: 1767, dur: 100 }, { x: 2232, y: 1767, dur: 100 },
			{ x: 2356, y: 1767, dur: 100 }, { x: 2480, y: 1767, dur: 100 },
			{ x: 2604, y: 1767, dur: 100 }, { x: 2728, y: 1767, dur: 100 },
			{ x: 2852, y: 1767, dur: 100 }, { x: 2976, y: 1767, dur: 100 },
			{ x: 3100, y: 1767, dur: 100 }, { x: 3224, y: 1767, dur: 100 },
			{ x: 0, y: 1860, dur: 100 }, { x: 124, y: 1860, dur: 100 },
			{ x: 248, y: 1860, dur: 1200 }, { x: 372, y: 1860, dur: 100 },
			{ x: 248, y: 1860, dur: 1300 }, { x: 496, y: 1860, dur: 50 },
			{ x: 2976, y: 1767, dur: 50 }, { x: 0, y: 0, dur: 100 },
		],
		Greeting: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 1612, y: 2790, dur: 100 }, { x: 1736, y: 2790, dur: 100 },
			{ x: 1860, y: 2790, dur: 100 }, { x: 1984, y: 2790, dur: 100 },
			{ x: 2108, y: 2790, dur: 100 }, { x: 2232, y: 2790, dur: 100 },
			{ x: 2356, y: 2790, dur: 100 }, { x: 2480, y: 2790, dur: 100 },
			{ x: 2604, y: 2790, dur: 100 }, { x: 2728, y: 2790, dur: 100 },
			{ x: 2852, y: 2790, dur: 100 }, { x: 2976, y: 2790, dur: 100 },
			{ x: 3100, y: 2790, dur: 100 }, { x: 3224, y: 2790, dur: 100 },
			{ x: 0, y: 2883, dur: 100 }, { x: 124, y: 2883, dur: 100 },
			{ x: 248, y: 2883, dur: 100 }, { x: 372, y: 2883, dur: 300 },
			{ x: 496, y: 2883, dur: 100 }, { x: 372, y: 2883, dur: 450 },
			{ x: 620, y: 2883, dur: 100 }, { x: 744, y: 2883, dur: 100 },
			{ x: 868, y: 2883, dur: 100 }, { x: 992, y: 2883, dur: 100 },
			{ x: 1116, y: 2883, dur: 100 }, { x: 1240, y: 2883, dur: 100 },
			{ x: 1364, y: 2883, dur: 100 }, { x: 1488, y: 2883, dur: 100 },
			{ x: 1612, y: 2883, dur: 100 },
			{ x: 992, y: 1395, dur: 100 }, { x: 1116, y: 1395, dur: 100 },
			{ x: 1240, y: 1395, dur: 100 }, { x: 1364, y: 1395, dur: 100 },
			{ x: 1488, y: 1395, dur: 100 }, { x: 1612, y: 1395, dur: 100 },
			{ x: 1736, y: 1395, dur: 100 }, { x: 1860, y: 1395, dur: 100 },
			{ x: 0, y: 0, dur: 100 },
		],
		GetAttention: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 1240, y: 651, dur: 100 }, { x: 1364, y: 651, dur: 100 },
			{ x: 1488, y: 651, dur: 100 }, { x: 1612, y: 651, dur: 100 },
			{ x: 1736, y: 651, dur: 100 }, { x: 1860, y: 651, dur: 100 },
			{ x: 1984, y: 651, dur: 100 }, { x: 2108, y: 651, dur: 100 },
			{ x: 2232, y: 651, dur: 100 }, { x: 2356, y: 651, dur: 150 },
			{ x: 2232, y: 651, dur: 150 }, { x: 2356, y: 651, dur: 150 },
			{ x: 2232, y: 651, dur: 150 }, { x: 2480, y: 651, dur: 150 },
			{ x: 2604, y: 651, dur: 100 }, { x: 2728, y: 651, dur: 100 },
			{ x: 2852, y: 651, dur: 100 }, { x: 2976, y: 651, dur: 100 },
			{ x: 3100, y: 651, dur: 100 }, { x: 3224, y: 651, dur: 100 },
			{ x: 0, y: 744, dur: 100 }, { x: 124, y: 744, dur: 100 },
			{ x: 0, y: 0, dur: 100 },
		],
		IdleEyeBrowRaise: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 1116, y: 186, dur: 100 }, { x: 1240, y: 186, dur: 100 },
			{ x: 1364, y: 186, dur: 900 }, { x: 1240, y: 186, dur: 100 },
			{ x: 1116, y: 186, dur: 100 }, { x: 0, y: 0, dur: 100 },
		],
		IdleFingerTap: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 2976, y: 2976, dur: 100 }, { x: 3100, y: 2976, dur: 100 },
			{ x: 3224, y: 2976, dur: 100 }, { x: 0, y: 3069, dur: 100 },
			{ x: 124, y: 3069, dur: 100 }, { x: 248, y: 3069, dur: 150 },
			{ x: 372, y: 3069, dur: 100 }, { x: 496, y: 3069, dur: 100 },
			{ x: 620, y: 3069, dur: 100 }, { x: 0, y: 0, dur: 100 },
		],
		LookRight: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 620, y: 651, dur: 100 }, { x: 744, y: 651, dur: 100 },
			{ x: 868, y: 651, dur: 1200 }, { x: 992, y: 651, dur: 100 },
			{ x: 1116, y: 651, dur: 100 }, { x: 0, y: 0, dur: 100 },
		],
		LookLeft: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 248, y: 1488, dur: 100 }, { x: 372, y: 1488, dur: 100 },
			{ x: 496, y: 1488, dur: 1200 }, { x: 620, y: 1488, dur: 100 },
			{ x: 744, y: 1488, dur: 100 }, { x: 0, y: 0, dur: 100 },
		],
		IdleHeadScratch: [
			{ x: 1984, y: 2418, dur: 100 }, { x: 2108, y: 2418, dur: 100 },
			{ x: 2232, y: 2418, dur: 100 }, { x: 2356, y: 2418, dur: 100 },
			{ x: 2480, y: 2418, dur: 100 }, { x: 2604, y: 2418, dur: 100 },
			{ x: 2728, y: 2418, dur: 100 }, { x: 2852, y: 2418, dur: 100 },
			{ x: 2976, y: 2418, dur: 100 }, { x: 3100, y: 2418, dur: 100 },
			{ x: 3224, y: 2418, dur: 100 }, { x: 0, y: 2511, dur: 100 },
			{ x: 124, y: 2511, dur: 100 }, { x: 248, y: 2511, dur: 100 },
			{ x: 372, y: 2511, dur: 100 }, { x: 496, y: 2511, dur: 100 },
			{ x: 620, y: 2511, dur: 100 }, { x: 744, y: 2511, dur: 100 },
			{ x: 868, y: 2511, dur: 100 }, { x: 0, y: 0, dur: 100 },
		],
		Writing: [
			{ x: 0, y: 0, dur: 100 },
			{ x: 1860, y: 1860, dur: 100 }, { x: 1984, y: 1860, dur: 100 },
			{ x: 2108, y: 1860, dur: 100 }, { x: 2232, y: 1860, dur: 100 },
			{ x: 2356, y: 1860, dur: 100 }, { x: 2480, y: 1860, dur: 100 },
			{ x: 2604, y: 1860, dur: 100 }, { x: 2728, y: 1860, dur: 100 },
			{ x: 2852, y: 1860, dur: 100 }, { x: 2976, y: 1860, dur: 100 },
			{ x: 3100, y: 1860, dur: 100 }, { x: 3224, y: 1860, dur: 100 },
			{ x: 0, y: 1953, dur: 100 }, { x: 124, y: 1953, dur: 100 },
			{ x: 248, y: 1953, dur: 100 }, { x: 372, y: 1953, dur: 200 },
			{ x: 496, y: 1953, dur: 200 }, { x: 620, y: 1953, dur: 200 },
			{ x: 744, y: 1953, dur: 200 }, { x: 868, y: 1953, dur: 200 },
			{ x: 992, y: 1953, dur: 200 }, { x: 1116, y: 1953, dur: 200 },
			{ x: 1240, y: 1953, dur: 200 }, { x: 1364, y: 1953, dur: 200 },
			{ x: 1488, y: 1953, dur: 200 }, { x: 1612, y: 1953, dur: 100 },
			{ x: 1736, y: 1953, dur: 100 }, { x: 1860, y: 1953, dur: 400 },
			{ x: 1984, y: 1953, dur: 100 }, { x: 2108, y: 1953, dur: 400 },
			{ x: 2232, y: 1953, dur: 100 }, { x: 2356, y: 1953, dur: 100 },
			{ x: 2480, y: 1953, dur: 100 }, { x: 2604, y: 1953, dur: 200 },
			{ x: 2728, y: 1953, dur: 200 }, { x: 2852, y: 1953, dur: 200 },
			{ x: 2976, y: 1953, dur: 200 }, { x: 3100, y: 1953, dur: 100 },
			{ x: 3224, y: 1953, dur: 200 }, { x: 0, y: 2046, dur: 200 },
			{ x: 124, y: 2046, dur: 200 }, { x: 248, y: 2046, dur: 100 },
			{ x: 372, y: 2046, dur: 100 }, { x: 496, y: 2046, dur: 100 },
			{ x: 620, y: 2046, dur: 100 }, { x: 744, y: 2046, dur: 100 },
			{ x: 868, y: 2046, dur: 100 }, { x: 992, y: 2046, dur: 100 },
			{ x: 1116, y: 2046, dur: 100 }, { x: 1240, y: 2046, dur: 100 },
			{ x: 1364, y: 2046, dur: 100 }, { x: 1488, y: 2046, dur: 100 },
			{ x: 1612, y: 2046, dur: 100 }, { x: 1736, y: 2046, dur: 100 },
			{ x: 1860, y: 2046, dur: 100 }, { x: 1984, y: 2046, dur: 100 },
			{ x: 2108, y: 2046, dur: 100 }, { x: 2232, y: 2046, dur: 100 },
			{ x: 2356, y: 2046, dur: 100 }, { x: 0, y: 0, dur: 100 },
		],
	};

	const animNames = Object.keys(animations);

	let position = $state({ x: 0, y: 0 });
	let dragging = $state(false);
	let currentTip = $state(0);
	let showBubble = $state(true);
	let dismissed = $state(false);
	let spriteX = $state(0);
	let spriteY = $state(0);
	let animating = false;
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

	function playAnimation(name?: string) {
		if (animating) return;
		const animName = name || animNames[Math.floor(Math.random() * animNames.length)];
		const frames = animations[animName];
		if (!frames) return;

		animating = true;
		let i = 0;

		function step() {
			if (i >= frames.length) {
				spriteX = 0;
				spriteY = 0;
				animating = false;
				scheduleNext();
				return;
			}
			spriteX = frames[i].x;
			spriteY = frames[i].y;
			const dur = Math.max(frames[i].dur, 16);
			i++;
			animTimeout = setTimeout(step, dur);
		}
		step();
	}

	function scheduleNext() {
		animTimeout = setTimeout(() => playAnimation(), 4000 + Math.random() * 6000);
	}

	function onBodyClick() {
		if (dragging) return;
		if (!showBubble) {
			showBubble = true;
		}
		nextTip();
		resetTipInterval();
		// Play a fun animation on click
		if (!animating) {
			clearTimeout(animTimeout);
			const clickAnims = ['Wave', 'Greeting', 'GetAttention'];
			playAnimation(clickAnims[Math.floor(Math.random() * clickAnims.length)]);
		}
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
		// Start with a Greeting
		setTimeout(() => playAnimation('Greeting'), 1500);

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
