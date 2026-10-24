/**
 * The vendored client (src/lib/vendor/vault-sdk, from a clean `git archive` export of hops integration
 * 3e9aa75): the files are the ones SHA256SUMS names, the module is the pinned 79bf6de8…, the glue ships no
 * test helper; and the page's own code has no network in the Worker and logs nothing.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORE_WASM_SHA256, CORE_WASM_BYTES } from '$lib/vendor/vault-sdk/checksums.js';
import { VIEWER_METHODS } from '$lib/vendor/vault-sdk/viewer.js';

const VENDOR = fileURLToPath(new URL('../vendor/vault-sdk/', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('vendored client module', () => {
	it('every vendored file is the one SHA256SUMS names', () => {
		const lines = readFileSync(VENDOR + 'SHA256SUMS', 'utf8').trim().split('\n');
		expect(lines.length).toBe(14);
		for (const l of lines) {
			const [h, f] = l.split(/\s+/);
			expect(sha(VENDOR + f), f).toBe(h);
		}
	});

	it('the module is the pinned client 79bf6de8…, 3,708,297 bytes', () => {
		expect(CORE_WASM_SHA256).toBe('79bf6de8198bf5dbfde468fb2608b1d3978c0ed75a8eeea2ed3c5243d076bb55');
		expect(CORE_WASM_BYTES).toBe(3708297);
		expect(sha(VENDOR + 'wasm/vault_core_bg.wasm')).toBe(CORE_WASM_SHA256);
	});

	it('ships the viewer and no test helper; the viewer API is reads only', () => {
		const glue = readFileSync(VENDOR + 'wasm/vault_core.js', 'utf8');
		expect(glue).toContain('openViewKey');
		expect(glue).not.toContain('viewKeySecretsForTests');
		expect(glue).not.toContain('class WasmSim');
		expect([...VIEWER_METHODS].sort()).toEqual(['accounts', 'addressBalances', 'balances', 'close', 'exitAddresses', 'fingerprint', 'generations', 'history', 'notes', 'open', 'spendingAccounts', 'status', 'sync', 'warnings']);
	});
});

describe('the page code', () => {
	const src = (f: string) => readFileSync(HERE + f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

	it('the Worker side has no network of its own', () => {
		for (const f of ['host.ts', 'viewer.worker.ts', 'protocol.ts']) {
			expect(src(f), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|navigator\./);
		}
	});

	it('nothing logs or stores (no console, no storage)', () => {
		const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
		expect(files.length).toBeGreaterThan(8);
		for (const f of files) expect(src(f), f).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|document\.cookie/);
		const page = readFileSync(fileURLToPath(new URL('../../routes/view/+page.svelte', import.meta.url)), 'utf8');
		expect(page).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB/);
	});

	it('the only POST is the screening of addresses', () => {
		const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
		const posts = files.filter((f) => /method:\s*'POST'/.test(src(f)));
		expect(posts).toEqual(['screen.ts']);
		expect(src('screen.ts')).toMatch(/body: JSON\.stringify\(\{ addresses: batch \}\)/);
	});
});
