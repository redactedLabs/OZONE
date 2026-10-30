/**
 * The site's look: 'redacted' (the style of redacted.gg, the default) or 'win98'. The visitor's choice is kept
 * in localStorage under `theme`; app.html applies it before the first paint, this store keeps it afterwards.
 */
export type Theme = 'redacted' | 'win98';

const KEY = 'theme';

/**
 * The stored theme, or null. 'dark' is the modern theme from before the Redacted one (until 2026-10-30): its
 * visitors chose the modern look, which is now the Redacted theme. A browser that refuses site data throws on any
 * `localStorage` access, and a runtime may have a `localStorage` without Storage methods; the root layout loads
 * this store on every page, so it never throws (src/lib/stores/theme.test.ts).
 */
function stored(): Theme | null {
	try {
		const v = globalThis.localStorage?.getItem(KEY);
		return v === 'win98' ? 'win98' : v === 'redacted' || v === 'dark' ? 'redacted' : null;
	} catch {
		return null;
	}
}

function store(v: Theme) {
	try {
		globalThis.localStorage?.setItem(KEY, v);
	} catch {
		// Storage refused: the theme holds for this page only.
	}
}

let current = $state<Theme>(stored() ?? 'redacted');

export const theme = {
	get current() { return current; },
	toggle() {
		current = current === 'win98' ? 'redacted' : 'win98';
		store(current);
		this.apply();
	},
	apply() {
		document.documentElement.className = current;
	}
};
