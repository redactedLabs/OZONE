/**
 * Browser only: start the viewer Worker and load the client module into it. The module comes from
 * Ozone itself (same origin) and is instantiated only when its SHA-256 is the pinned one (E-30).
 */
import wasmUrl from '$lib/vendor/vault-sdk/wasm/vault_core_bg.wasm?url';
import { ViewerBridge, type Port } from './bridge';

/** The Worker loads and checks the module within this time, or the page says so. */
const START_TIMEOUT_MS = 60_000;

export async function startViewer(): Promise<ViewerBridge> {
	const worker = new Worker(new URL('./viewer.worker.ts', import.meta.url), { type: 'module', name: 'ozone-viewer' });
	const bridge = new ViewerBridge(worker as unknown as Port);
	try {
		const res = await fetch(wasmUrl, { credentials: 'omit' });
		if (!res.ok) throw new Error(`the client module answered ${res.status}`);
		const bytes = await res.arrayBuffer();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(Object.assign(new Error('the viewer did not start'), { code: 'VIEWER_START' })), START_TIMEOUT_MS);
		});
		try {
			await Promise.race([bridge.init(bytes), late]);
		} finally {
			clearTimeout(timer);
		}
	} catch (e) {
		bridge.close();
		throw e;
	}
	return bridge;
}
