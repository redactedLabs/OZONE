/**
 * The vendored client (src/lib/vendor/vault-sdk, from a clean `git archive` export of hops integration
 * 6e41c95): the files are the ones SHA256SUMS names, the module is the pinned 9a945b79…, the glue ships no
 * test helper, the open bindings take the file as the page passes it; and the page's own code has no network
 * in the Worker, logs nothing, and stores only the history files' window seeds (seed.ts).
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

	it('the module is the pinned client 9a945b79…, 4,286,819 bytes, with the glue of integration 6e41c95', () => {
		expect(CORE_WASM_SHA256).toBe('9a945b792dd4f777973d2416307e5341ceae69229fb284c871f5676ab9ae3ec0');
		expect(CORE_WASM_BYTES).toBe(4286819);
		expect(sha(VENDOR + 'wasm/vault_core_bg.wasm')).toBe(CORE_WASM_SHA256);
		expect(readFileSync(VENDOR + 'wasm/vault_core_bg.wasm').length).toBe(CORE_WASM_BYTES);
		// INTEGRATION.md §1 (row "every device run-2 to run-5", b7d2600) and §5.1: the glue the module was cut with
		expect(sha(VENDOR + 'wasm/vault_core.js')).toBe('cb54e979153e61416f904f269d81ba6e62443769461c0da281e3072a38809cbd');
		expect(readFileSync(VENDOR + 'wasm/vault_core.js').length).toBe(288980);
	});

	it('openViewKey and openHistory take the file as a string, by value (wiped in the module), as the viewer passes it', () => {
		// Rujira 78/81 review run-3: the module takes the file by value and wipes its copy; the TS types stay
		// (file: string, deployment_json: string), so ViewerService.open / openHistory pass the page's text unchanged
		const dts = readFileSync(VENDOR + 'wasm/vault_core.d.ts', 'utf8');
		expect(dts).toContain('export function openViewKey(file: string, deployment_json: string): WasmViewSession;');
		expect(dts).toContain('export function openHistory(file: string, deployment_json: string): WasmHistorySession;');
		const core = readFileSync(VENDOR + 'core.d.ts', 'utf8');
		expect(core).toContain('openViewKey(file: string, deploymentJson: string): any;');
		expect(core).toContain('openHistory(file: string, deploymentJson: string): any;');
		const viewer = readFileSync(VENDOR + 'viewer.js', 'utf8');
		expect(viewer).toContain('core().openViewKey(file, JSON.stringify(this.env.deployment))');
		expect(viewer).toContain('core().openHistory(file, JSON.stringify(this.env.deployment))');
	});

	it('ships the viewer and no test helper; the viewer API is reads only', () => {
		const glue = readFileSync(VENDOR + 'wasm/vault_core.js', 'utf8');
		expect(glue).toContain('openViewKey');
		expect(glue).toContain('openHistory');
		expect(glue).not.toContain('viewKeySecretsForTests');
		expect(glue).not.toContain('class WasmSim');
		expect([...VIEWER_METHODS].sort()).toEqual(
			['accounts', 'addressBalances', 'balances', 'close', 'exitAddresses', 'fingerprint', 'generations', 'history', 'notes', 'open', 'spendingAccounts', 'status', 'sync', 'warnings', 'openHistory', 'historyCut', 'verifyHistory', 'historyStatus', 'historyItems', 'historyTotals', 'historyAccounts', 'historyWarnings', 'closeHistory'].sort()
		);
	});
});

describe('the page code', () => {
	const src = (f: string) => readFileSync(HERE + f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

	it('the Worker side has no network of its own', () => {
		for (const f of ['host.ts', 'viewer.worker.ts', 'protocol.ts']) {
			expect(src(f), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|navigator\./);
		}
	});

	it('nothing logs; nothing stores but the window seeds (seed.ts, localStorage, one key per fingerprint)', () => {
		const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
		expect(files.length).toBeGreaterThan(8);
		for (const f of files) expect(src(f), f).not.toMatch(/console\.|sessionStorage|indexedDB|document\.cookie|caches\./);
		expect(files.filter((f) => /localStorage/.test(src(f)))).toEqual(['seed.ts']);
		expect(src('seed.ts')).toMatch(/const KEY_PREFIX = 'ozone\.view\.window-seed\.'/);
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
