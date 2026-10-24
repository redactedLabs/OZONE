/**
 * The viewer Worker run in-process for tests: the page's `ViewerBridge` talks to `createHost` through
 * structured-cloned messages, as it would to the Worker, with the vendored production client module.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ViewerBridge, type Port } from '../bridge';
import { createHost } from '../host';
import type { FromWorker, ToWorker } from '../protocol';

export const WASM_PATH = fileURLToPath(new URL('../../vendor/vault-sdk/wasm/vault_core_bg.wasm', import.meta.url));

export function wasmBytes(): ArrayBuffer {
	const b = readFileSync(WASM_PATH);
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** A bridge to an in-process host; `toWorker` records every message the page sends the Worker. */
export function inProcessViewer() {
	const toWorker: ToWorker[] = [];
	let host: (m: ToWorker) => Promise<void>;
	const port: Port = {
		onmessage: null,
		postMessage(m: ToWorker) {
			const copy = structuredClone(m);
			toWorker.push(copy);
			queueMicrotask(() => void host(copy));
		}
	};
	host = createHost((m: FromWorker) => {
		const copy = structuredClone(m);
		queueMicrotask(() => port.onmessage?.({ data: copy }));
	});
	const bridge = new ViewerBridge(port);
	// as the Worker does once its handler is set
	queueMicrotask(() => port.onmessage?.({ data: { kind: 'ready' } }));
	return { bridge, toWorker };
}
