<script lang="ts">
	// The screening in the Redacted hero, as one loop: an address comes in, the Ozone scanner checks every
	// list in turn, a verdict comes out. Three addresses, 4 s each (12 s loop), pure CSS. An illustration,
	// not live data.
	import Ghost from './Ghost.svelte';

	const SCANS = [
		{ name: 'Bitcoin', logo: 'btc', addr: 'bc1q…k7wz', flagged: false, hit: -1 },
		{ name: 'Ethereum', logo: 'eth', addr: '0x7f3a…19c2', flagged: true, hit: 6 },
		{ name: 'THORChain', logo: 'rune', addr: 'thor1…8m4q', flagged: false, hit: -1 }
	];
	const LISTS = ['OFAC', 'UK', 'EU', 'FBI', 'Tether', 'Circle', 'Hacks', 'Traces'];
	const REASON = 'Received from a listed hack via THORChain';
</script>

<!-- address → the scanner → verdict: one row from 768 px, a compact stack on a phone -->
<div class="sh" aria-hidden="true">
	<div class="sh-lane">
		<div class="sh-slot">
			{#each SCANS as s, i (s.addr)}
				<div class="sh-slot-card sh-in" style="--d: {i * 4}s;">
					<img src="/coins/{s.logo}.webp" alt="" width="36" height="36" />
					<span class="sh-text"><b>{s.name}</b><code>{s.addr}</code></span>
				</div>
			{/each}
		</div>
		<div class="sh-link"></div>
		<div class="sh-device">
			<span class="rd-tile sh-tile"><Ghost /></span>
			<div class="sh-device-title">Screening</div>
			<div class="sh-device-chips">
				{#each SCANS as s, i (s.addr)}
					<div class="sh-chips" style="--d: {i * 4}s;">
						{#each LISTS as l, j (l)}
							<span class="sh-chip" class:sh-hit={j === s.hit} style="--c: {0.5 + j * 0.2}s;">{l}</span>
						{/each}
					</div>
				{/each}
			</div>
		</div>
		<div class="sh-link"></div>
		<div class="sh-slot">
			{#each SCANS as s, i (s.addr)}
				<div class="sh-slot-card sh-out" class:sh-bad={s.flagged} style="--d: {i * 4}s;">
					<span class="sh-verdict-icon">{s.flagged ? '!' : '✓'}</span>
					<span class="sh-text"><b>{s.flagged ? 'Flagged' : 'Clear'}</b><small>{s.flagged ? REASON : 'Checked against every list'}</small></span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* timing (12 s loop, one address per 4 s, address i delayed by --d): in 0–0.35 s, lists 0.5–1.9 s,
	   verdict from 2.2 s, out 3.6–4 s. Crisp: opacity and a short slide, no blur. */
	.sh {
		--grad: linear-gradient(160deg, #3bd8cf 0%, #29b4f2 48%, #1f8ff0 100%);
		margin: 28px auto 32px;
		text-align: left;
		color: #0a111c;
	}
	.sh-lane {
		display: grid;
		grid-template-columns: 1fr auto 230px auto 1fr;
		align-items: center;
		max-width: 1000px;
		margin: 0 auto;
	}

	/* the address and the verdict: one card at a time in each slot */
	.sh-slot {
		display: grid;
		height: 76px;
	}
	.sh-slot-card {
		grid-area: 1 / 1;
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: 0 16px;
		border-radius: 20px;
		background: #fff;
		border: 1px solid rgba(10, 17, 28, 0.07);
		box-shadow: 0 20px 40px -24px rgba(10, 17, 28, 0.35);
	}
	.sh-slot-card img {
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: 999px;
	}
	.sh-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.sh-text b {
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.sh-text code {
		font: 500 12.5px/1.4 var(--font-mono);
		color: #6a7686;
	}
	.sh-text small {
		font-size: 12.5px;
		color: #6a7686;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sh-out {
		border: 1.5px solid transparent;
		background: linear-gradient(#fff, #fff) padding-box, var(--grad) border-box;
	}
	.sh-out.sh-bad b {
		color: #c23a41;
	}
	.sh-verdict-icon {
		flex: none;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 999px;
		background: var(--grad);
		color: #fff;
		font-size: 14px;
		font-weight: 700;
	}
	.sh-bad .sh-verdict-icon {
		background: #f2545b;
	}
	.sh-in {
		animation: sh-in 12s var(--d) infinite both;
	}
	.sh-out {
		animation: sh-out 12s var(--d) infinite both;
	}
	@keyframes sh-in {
		0% { opacity: 0; transform: translateX(-16px); }
		3% { opacity: 1; transform: none; }
		18% { opacity: 1; transform: none; }
		21% { opacity: 0.35; transform: none; }
		30% { opacity: 0.35; }
		33.3%, 100% { opacity: 0; }
	}
	@keyframes sh-out {
		0%, 18% { opacity: 0; transform: translateX(-16px); }
		21% { opacity: 1; transform: none; }
		30% { opacity: 1; transform: none; }
		33.3%, 100% { opacity: 0; transform: translateX(16px); }
	}

	/* the dashed links into and out of the scanner */
	.sh-link {
		width: 36px;
		height: 2px;
		margin: 0 8px;
		background: repeating-linear-gradient(90deg, rgba(31, 143, 240, 0.5) 0 6px, transparent 6px 12px);
		background-size: 24px 2px;
		animation: sh-dash 0.8s linear infinite;
	}
	@keyframes sh-dash {
		to { background-position: 24px 0; }
	}

	/* the scanner: the ghost, and the lists lighting up in turn */
	.sh-device {
		padding: 18px 16px 16px;
		border-radius: 26px;
		text-align: center;
		border: 1.5px solid transparent;
		background: linear-gradient(#fff, #fff) padding-box, var(--grad) border-box;
		box-shadow: 0 0 40px -10px rgba(41, 180, 242, 0.6), 0 30px 60px -30px rgba(10, 17, 28, 0.4);
	}
	.sh-tile {
		width: 48px;
		height: 48px;
		border-radius: 15px;
		box-shadow: 0 14px 30px -10px rgba(41, 180, 242, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.35);
	}
	.sh-device-title {
		margin: 8px 0 10px;
		font-size: 15px;
		font-weight: 600;
	}
	.sh-device-chips {
		display: grid;
	}
	.sh-chips {
		grid-area: 1 / 1;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		animation: sh-set 12s var(--d) infinite both;
	}
	@keyframes sh-set {
		0% { opacity: 0; }
		3%, 30% { opacity: 1; }
		33.3%, 100% { opacity: 0; }
	}
	.sh-chip {
		padding: 3px 7px;
		border-radius: 999px;
		background: rgba(10, 17, 28, 0.04);
		box-shadow: inset 0 0 0 1px rgba(10, 17, 28, 0.06);
		font: 500 10.5px/1.4 var(--font-mono);
		color: #6a7686;
		animation: sh-chip 12s calc(var(--d) + var(--c)) infinite both;
	}
	.sh-chip.sh-hit {
		animation-name: sh-chip-hit;
	}
	@keyframes sh-chip {
		0% { background: rgba(10, 17, 28, 0.04); color: #6a7686; box-shadow: inset 0 0 0 1px rgba(10, 17, 28, 0.06); }
		1.5%, 26% { background: rgba(59, 216, 207, 0.16); color: #0a111c; box-shadow: inset 0 0 0 1px rgba(59, 216, 207, 0.55); }
		28%, 100% { background: rgba(10, 17, 28, 0.04); color: #6a7686; box-shadow: inset 0 0 0 1px rgba(10, 17, 28, 0.06); }
	}
	@keyframes sh-chip-hit {
		0% { background: rgba(10, 17, 28, 0.04); color: #6a7686; box-shadow: inset 0 0 0 1px rgba(10, 17, 28, 0.06); }
		1.5%, 26% { background: rgba(242, 84, 91, 0.12); color: #c23a41; box-shadow: inset 0 0 0 1px rgba(242, 84, 91, 0.6); }
		28%, 100% { background: rgba(10, 17, 28, 0.04); color: #6a7686; box-shadow: inset 0 0 0 1px rgba(10, 17, 28, 0.06); }
	}

	/* phones: a compact stack */
	@media (max-width: 767px) {
		.sh {
			margin: 22px auto 24px;
		}
		.sh-lane {
			grid-template-columns: 1fr;
			justify-items: center;
		}
		.sh-slot {
			width: min(320px, 100%);
			height: 64px;
		}
		.sh-slot-card img {
			width: 30px;
			height: 30px;
		}
		.sh-text b {
			font-size: 15px;
		}
		.sh-link {
			width: 2px;
			height: 14px;
			margin: 4px 0;
			background: repeating-linear-gradient(180deg, rgba(31, 143, 240, 0.5) 0 4px, transparent 4px 8px);
			background-size: 2px 16px;
			animation-name: sh-dash-v;
		}
		.sh-device {
			display: grid;
			grid-template-columns: auto 1fr;
			align-items: center;
			gap: 0 12px;
			width: min(320px, 100%);
			padding: 12px 14px;
			text-align: left;
		}
		.sh-tile {
			grid-row: span 2;
			width: 40px;
			height: 40px;
		}
		.sh-device-title {
			margin: 0 0 6px;
			font-size: 14px;
		}
		.sh-chips {
			justify-content: flex-start;
		}
		.sh-chip {
			padding: 2px 6px;
			font-size: 10px;
		}
	}
	@keyframes sh-dash-v {
		to { background-position: 0 16px; }
	}

	/* reduced motion: one finished result, no loop */
	@media (prefers-reduced-motion: reduce) {
		.sh * {
			animation: none !important;
		}
		.sh-slot > :not(:first-child),
		.sh-chips:not(:first-child) {
			display: none;
		}
	}
</style>
