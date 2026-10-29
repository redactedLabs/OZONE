/**
 * The theme store (theme.svelte.ts) is loaded by the root layout, so every page of the site, /view included, needs it
 * to load. It must survive a browser that refuses site data: there, reading `localStorage` throws (SecurityError),
 * `getItem`/`setItem` can throw (QuotaExceededError), and Node 25's global `localStorage` without a storage file has
 * no `getItem` at all. The store then starts on win98 and still toggles and applies, for this page only.
 *
 * The real module is compiled with Svelte's own compiler (client output, as the browser gets it) and loaded fresh
 * for each case, so its top-level storage read runs again under each stub.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileModule } from 'svelte/compiler';
import { transformWithEsbuild } from 'vite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Theme = {
	readonly current: string;
	toggle(): void;
	apply(): void;
};

const SOURCE = fileURLToPath(new URL('./theme.svelte.ts', import.meta.url));
const RUNTIME = pathToFileURL(createRequire(import.meta.url).resolve('svelte/internal/client')).href;
const dir = mkdtempSync(join(tmpdir(), 'ozone-theme-'));
let n = 0;

const g = globalThis as Record<string, unknown>;
const saved = { localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), document: g.document };

/** Sets `globalThis.localStorage` to a value, or to a getter that throws as a blocked browser does. */
function setStorage(s: { value: unknown } | { throws: Error }) {
	if ('throws' in s) {
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw s.throws; } });
	} else {
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: s.value });
	}
}

async function load(): Promise<{ theme: Theme; html: { className: string } }> {
	const html = { className: '' };
	g.document = { documentElement: html };
	const ts = readFileSync(SOURCE, 'utf8');
	const js = (await transformWithEsbuild(ts, 'theme.svelte.ts', { loader: 'ts' })).code;
	const out = compileModule(js, { filename: 'theme.svelte.js', generate: 'client' }).js.code;
	expect(out).toContain("from 'svelte/internal/client'");
	const file = join(dir, `theme-${++n}.mjs`);
	writeFileSync(file, out.replace("'svelte/internal/client'", JSON.stringify(RUNTIME)));
	const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
	return { theme: mod.theme as Theme, html };
}

/** A working Storage over a Map, recording writes. */
function memoryStorage(init: Record<string, string> = {}) {
	const m = new Map(Object.entries(init));
	return {
		map: m,
		getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
		setItem: (k: string, v: string) => void m.set(k, String(v)),
		removeItem: (k: string) => void m.delete(k)
	};
}

const securityError = () => Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });

afterEach(() => {
	if (saved.localStorage) Object.defineProperty(globalThis, 'localStorage', saved.localStorage);
	else delete g.localStorage;
	if (saved.document === undefined) delete g.document;
	else g.document = saved.document;
});

describe('theme store without site data', () => {
	it('loads, starts on win98, toggles and applies when reading localStorage throws (blocked site data)', async () => {
		setStorage({ throws: securityError() });
		const { theme, html } = await load();
		expect(theme.current).toBe('win98');
		expect(() => theme.toggle()).not.toThrow();
		expect(theme.current).toBe('dark');
		expect(html.className).toBe('dark');
		theme.toggle();
		expect(theme.current).toBe('win98');
		expect(html.className).toBe('win98');
	});

	it('loads and toggles when getItem and setItem throw', async () => {
		setStorage({
			value: {
				getItem: () => { throw securityError(); },
				setItem: () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }
			}
		});
		const { theme, html } = await load();
		expect(theme.current).toBe('win98');
		expect(() => theme.toggle()).not.toThrow();
		expect(theme.current).toBe('dark');
		expect(html.className).toBe('dark');
	});

	it('loads and toggles when localStorage has no Storage methods (Node 25 without a storage file)', async () => {
		setStorage({ value: {} });
		const { theme } = await load();
		expect(theme.current).toBe('win98');
		expect(() => theme.toggle()).not.toThrow();
		expect(theme.current).toBe('dark');
	});

	it('loads and toggles with no localStorage at all (the server)', async () => {
		delete g.localStorage;
		const { theme } = await load();
		expect(theme.current).toBe('win98');
		expect(() => theme.toggle()).not.toThrow();
		expect(theme.current).toBe('dark');
	});
});

describe('theme store with site data', () => {
	it('reads the stored theme and stores each toggle', async () => {
		const s = memoryStorage({ theme: 'dark' });
		setStorage({ value: s });
		const { theme, html } = await load();
		expect(theme.current).toBe('dark');
		theme.toggle();
		expect(theme.current).toBe('win98');
		expect(s.map.get('theme')).toBe('win98');
		expect(html.className).toBe('win98');
		theme.toggle();
		expect(s.map.get('theme')).toBe('dark');
	});

	it('starts on win98 when nothing is stored, and ignores a value that is no theme', async () => {
		setStorage({ value: memoryStorage() });
		expect((await load()).theme.current).toBe('win98');
		setStorage({ value: memoryStorage({ theme: 'neon' }) });
		const { theme, html } = await load();
		expect(theme.current).toBe('win98');
		theme.apply();
		expect(html.className).toBe('win98');
	});
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
