/// <reference lib="webworker" />
// The viewer Worker: vault-core's view-only session, no network (see host.ts).
import { createHost } from './host';
import type { ToWorker } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const host = createHost((m) => scope.postMessage(m));
scope.onmessage = (e: MessageEvent<ToWorker>) => {
	void host(e.data);
};
// the page sends nothing before this (no message can arrive before the handler is set)
scope.postMessage({ kind: 'ready' });
