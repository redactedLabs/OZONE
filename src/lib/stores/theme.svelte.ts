let current = $state<'dark' | 'win98'>(
	(typeof localStorage !== 'undefined' && localStorage.getItem('theme') as 'dark' | 'win98') || 'dark'
);

export const theme = {
	get current() { return current; },
	toggle() {
		current = current === 'dark' ? 'win98' : 'dark';
		localStorage.setItem('theme', current);
		this.apply();
	},
	apply() {
		const html = document.documentElement;
		html.className = current === 'win98' ? 'win98' : 'dark';
	}
};
