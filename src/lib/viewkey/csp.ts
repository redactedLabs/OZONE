/**
 * The Content-Security-Policy of /view: scripts only from Ozone itself (with a per-response nonce for
 * SvelteKit's inline bootstrap), WebAssembly allowed for the client module, and network connections
 * only to the two chain sources and Ozone's own origin (its API and the client module). No frames, no
 * plugins, no form posts.
 */
import { chainOrigins } from './config';

export function newNonce(): string {
	const b = new Uint8Array(18);
	crypto.getRandomValues(b);
	let s = '';
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}

/** `dev` adds Vite's HMR socket (local development only). */
export function viewCsp(nonce: string, dev = false): string {
	const connect = ["'self'", ...chainOrigins(), ...(dev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : [])];
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
		"worker-src 'self'",
		`connect-src ${connect.join(' ')}`,
		"img-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		"font-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'"
	].join('; ');
}

/** Gives every `<script>` of the page the nonce (SvelteKit's bootstrap and the theme script of app.html). */
export function addNonce(html: string, nonce: string): string {
	return html.replace(/<script(?![^>]*\snonce=)(?=[\s>])/g, `<script nonce="${nonce}"`);
}
