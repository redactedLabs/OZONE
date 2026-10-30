import type { Action } from 'svelte/action';

/**
 * The info popup of a stat card (the `.stat-tip` inside it), shown above everything wherever the card sits:
 * the card's own `.stat-tip` stays hidden in place, a copy opens in <body> at a fixed position under the card
 * (above it when there is no room below), inside the viewport (full width less 16 px a side on a phone).
 * Mouse: on hover. Touch: the first tap opens it (a card that is a link waits), the next tap follows the link
 * or, on a card that is no link, closes it. It closes on a tap elsewhere, on scroll, on resize and on Escape.
 * Inside the card it could not: the page head is its own stacking context, so the cards after it (the globe)
 * painted over the popup.
 */
export const statTip: Action<HTMLElement> = (card) => {
	const MARGIN = 16;
	let tip: HTMLElement | null = null;
	let touch = false;

	function show() {
		const source = card.querySelector<HTMLElement>('.stat-tip');
		if (tip || !source) return;
		tip = source.cloneNode(true) as HTMLElement;
		Object.assign(tip.style, { display: 'block', position: 'fixed', zIndex: '1000', right: 'auto', minWidth: '0', visibility: 'hidden' });
		document.body.appendChild(tip);
		const r = card.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const width = vw < 640 ? vw - MARGIN * 2 : Math.min(Math.max(r.width, 280), 420);
		tip.style.width = `${width}px`;
		tip.style.left = `${Math.min(Math.max(r.left, MARGIN), vw - MARGIN - width)}px`;
		const height = tip.offsetHeight;
		const below = r.bottom + 8;
		const above = r.top - 8 - height;
		tip.style.top = `${below + height > window.innerHeight - 8 && above >= 8 ? above : below}px`;
		tip.style.visibility = '';
	}

	function hide() {
		tip?.remove();
		tip = null;
	}

	const onPointerDown = (e: PointerEvent) => (touch = e.pointerType !== 'mouse');
	const onEnter = (e: PointerEvent) => e.pointerType === 'mouse' && show();
	const onLeave = (e: PointerEvent) => e.pointerType === 'mouse' && hide();
	const onClick = (e: MouseEvent) => {
		if (!touch) return;
		if (!tip) {
			e.preventDefault();
			show();
		} else if (!(card instanceof HTMLAnchorElement)) hide();
	};
	// keyboard focus only: a tap focuses the link too, and must not count as the first tap already
	const onFocus = () => card.matches(':focus-visible') && show();
	const onOutside = (e: PointerEvent) => tip && !card.contains(e.target as Node) && hide();
	const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();

	card.addEventListener('pointerdown', onPointerDown);
	card.addEventListener('pointerenter', onEnter);
	card.addEventListener('pointerleave', onLeave);
	card.addEventListener('click', onClick);
	card.addEventListener('focusin', onFocus);
	card.addEventListener('focusout', hide);
	document.addEventListener('pointerdown', onOutside, true);
	window.addEventListener('scroll', hide, { capture: true, passive: true });
	window.addEventListener('resize', hide);
	window.addEventListener('keydown', onKey);

	return {
		destroy() {
			hide();
			card.removeEventListener('pointerdown', onPointerDown);
			card.removeEventListener('pointerenter', onEnter);
			card.removeEventListener('pointerleave', onLeave);
			card.removeEventListener('click', onClick);
			card.removeEventListener('focusin', onFocus);
			card.removeEventListener('focusout', hide);
			document.removeEventListener('pointerdown', onOutside, true);
			window.removeEventListener('scroll', hide, { capture: true });
			window.removeEventListener('resize', hide);
			window.removeEventListener('keydown', onKey);
		}
	};
};
