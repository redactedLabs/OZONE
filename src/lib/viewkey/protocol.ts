/**
 * Messages between the page and the viewer Worker. The Worker runs vault-core's view-only session
 * (`ViewerService`) and has no network of its own: every chain read is a request to the page, which
 * makes it under the page's Content-Security-Policy. The file text goes to the Worker only (in this
 * browser), never into a request.
 */
import type { DeploymentConfig, FileKind } from './config';
import type { FeedRecords } from './chain';

export interface ViewError {
	code: string;
	message: string;
}

export type ToWorker =
	| { kind: 'init'; id: number; wasm: ArrayBuffer }
	| { kind: 'open'; id: number; file: string; file_kind: FileKind; deployments: DeploymentConfig[] }
	| { kind: 'call'; id: number; method: string; params?: unknown[] }
	| { kind: 'env-reply'; id: number; result?: unknown; error?: ViewError };

export type FromWorker =
	| { kind: 'ready' }
	| { kind: 'result'; id: number; result?: unknown; error?: ViewError }
	| { kind: 'env'; id: number; fn: EnvFn; args: unknown[] };

export type EnvFn = 'height' | 'feedRecords' | 'balances' | 'blockHashes' | 'windowSeed';

/** What the page answers for the Worker (chain reads, both sources). */
export interface EnvProvider {
	height(): Promise<number>;
	feedRecords(): Promise<[FeedRecords, FeedRecords]>;
	balances(address: string): Promise<{ denom: string; amount: string }[]>;
	/** Errata E-68 (4): the header hash of the block at `height` from each source. */
	blockHashes(height: number): Promise<string[]>;
	/** Errata E-68 (15) R4-J1: this page's seed for the file (kept per fingerprint, never sent). */
	windowSeed(fingerprint: string): Promise<string>;
}

export interface Opened {
	kind: FileKind;
	fingerprint: string;
	/** A view key's named generations (empty for a history file). */
	generations: number[];
	/** A history file's cut and whether it names the held notes' nullifiers. */
	cut?: { height: number; block_hash: string };
	held_nullifiers?: boolean;
	deployment: { chain_id: string; proxy: string; label?: string; id: string };
}
