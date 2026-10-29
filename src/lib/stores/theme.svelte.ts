type Theme = 'dark' | 'win98';

const KEY = 'theme';

/**
 * The stored theme, or null. A browser that refuses site data throws on any `localStorage` access, and a runtime
 * may have a `localStorage` without Storage methods; the root layout loads this store on every page, so it never
 * throws (src/lib/stores/theme.test.ts).
 */
function stored(): Theme | null {
	try {
		const v = globalThis.localStorage?.getItem(KEY);
		return v === 'dark' || v === 'win98' ? v : null;
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

let current = $state<Theme>(stored() ?? 'win98');

export const theme = {
	get current() { return current; },
	toggle() {
		current = current === 'dark' ? 'win98' : 'dark';
		store(current);
		this.apply();
	},
	apply() {
		const html = document.documentElement;
		html.className = current === 'win98' ? 'win98' : 'dark';
	}
};
