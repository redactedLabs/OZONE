/**
 * Messages between the page and the viewer Worker. The Worker runs vault-core's view-only session
 * (`ViewerService`) and has no network of its own: every chain read is a request to the page, which
 * makes it under the page's Content-Security-Policy. The file text goes to the Worker only (in this
 * browser), never into a request.
 */
import type { DeploymentConfig } from './config';
import type { FeedRecords } from './chain';

export interface ViewError {
	code: string;
	message: string;
}

export type ToWorker =
	| { kind: 'init'; id: number; wasm: ArrayBuffer }
	| { kind: 'open'; id: number; file: string; deployments: DeploymentConfig[] }
	| { kind: 'call'; id: number; method: string; params?: unknown[] }
	| { kind: 'env-reply'; id: number; result?: unknown; error?: ViewError };

export type FromWorker =
	| { kind: 'ready' }
	| { kind: 'result'; id: number; result?: unknown; error?: ViewError }
	| { kind: 'env'; id: number; fn: 'height' | 'feedRecords' | 'balances'; args: unknown[] };

/** What the page answers for the Worker (chain reads, both sources). */
export interface EnvProvider {
	height(): Promise<number>;
	feedRecords(): Promise<[FeedRecords, FeedRecords]>;
	balances(address: string): Promise<{ denom: string; amount: string }[]>;
}

export interface Opened {
	fingerprint: string;
	generations: number[];
	deployment: { chain_id: string; proxy: string; label?: string; id: string };
}
