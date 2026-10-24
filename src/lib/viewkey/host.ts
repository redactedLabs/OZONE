/**
 * The Worker side of the viewer: vault-core's view-only session (`ViewerService`, errata E-66 (4))
 * behind `dispatchViewer`, which serves `VIEWER_METHODS` only (reads). It verifies the client module
 * against its pinned SHA-256 before running it (E-30, `initCore`), picks the deployment the file names,
 * and asks the page for every chain read (it has no network). Nothing here logs or stores anything.
 */
import { initCore, util, VaultError, asVaultError } from '$lib/vendor/vault-sdk/core.js';
import { ViewerService, dispatchViewer } from '$lib/vendor/vault-sdk/viewer.js';
import * as glue from '$lib/vendor/vault-sdk/wasm/vault_core.js';
import type { DeploymentConfig } from './config';
import { fileDeploymentId } from './file';
import type { FeedRecords } from './chain';
import type { FromWorker, Opened, ToWorker, ViewError } from './protocol';

type Post = (m: FromWorker) => void;

function toError(e: unknown): ViewError {
	const v = e instanceof VaultError ? e : asVaultError(e);
	return { code: v.code, message: v.message };
}

export function createHost(post: Post): (msg: ToWorker) => Promise<void> {
	let ready = false;
	let svc: ViewerService | null = null;
	let seq = 0;
	const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

	const ask = <T>(fn: 'height' | 'feedRecords' | 'balances', args: unknown[] = []): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			const id = ++seq;
			waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
			post({ kind: 'env', id, fn, args });
		});

	function open(file: string, configs: DeploymentConfig[]): Opened {
		if (!ready) throw new VaultError('NOT_INITIALIZED', 'the client module is not loaded');
		const id = fileDeploymentId(file);
		if (!id) throw new VaultError('VIEW_KEY_INVALID', 'not a view-key file: one line of JSON naming its deployment');
		for (const c of configs) {
			let d;
			try {
				d = util.deployment(c.chain_id, c.proxy, { hrp: c.hrp ?? 'thor', ...(c.account_code_checksum ? { accountCodeChecksum: c.account_code_checksum } : {}) });
			} catch {
				continue;
			}
			if (d.id !== id) continue;
			svc?.close();
			svc = new ViewerService({
				deployment: d,
				// one source is never used: the page always reads two (C5)
				readSnapshot: () => Promise.reject(new VaultError('UNSUPPORTED', 'the page reads two sources')),
				readSnapshots: async () => {
					const [a, b] = await ask<[FeedRecords, FeedRecords]>('feedRecords');
					return [util.snapshotFromFeeds(a as never), util.snapshotFromFeeds(b as never)];
				},
				height: () => ask<number>('height'),
				l1Account: async (address: string) => ({ accountNumber: 0, sequence: 0, balances: await ask<{ denom: string; amount: string }[]>('balances', [address]) })
			});
			const o = svc.open(file);
			return { fingerprint: o.fingerprint, generations: o.generations, deployment: { chain_id: c.chain_id, proxy: d.proxy, id: d.id, ...(c.label ? { label: c.label } : {}) } };
		}
		throw new VaultError('UNKNOWN_DEPLOYMENT', 'this view key is for a deployment Ozone does not read');
	}

	return async (msg: ToWorker) => {
		switch (msg.kind) {
			case 'env-reply': {
				const w = waiting.get(msg.id);
				if (!w) return;
				waiting.delete(msg.id);
				if (msg.error) w.reject(new VaultError(msg.error.code, msg.error.message));
				else w.resolve(msg.result);
				return;
			}
			case 'init': {
				try {
					// E-30: instantiated only when the bytes are the pinned module
					initCore(glue as never, new Uint8Array(msg.wasm));
					ready = true;
					post({ kind: 'result', id: msg.id, result: { version: util.version() } });
				} catch (e) {
					post({ kind: 'result', id: msg.id, error: toError(e) });
				}
				return;
			}
			case 'open': {
				try {
					post({ kind: 'result', id: msg.id, result: open(msg.file, msg.deployments) });
				} catch (e) {
					svc?.close();
					svc = null;
					post({ kind: 'result', id: msg.id, error: toError(e) });
				}
				return;
			}
			case 'call': {
				if (!svc) {
					post({ kind: 'result', id: msg.id, error: { code: 'LOCKED', message: 'open a view-key file first' } });
					return;
				}
				// `open` goes through the message above (it picks the deployment); every other read through dispatchViewer
				if (msg.method === 'open') {
					post({ kind: 'result', id: msg.id, error: { code: 'FORBIDDEN', message: 'open is a message of its own' } });
					return;
				}
				const r = await dispatchViewer(svc, { id: msg.id, method: msg.method, params: msg.params ?? [] });
				post({ kind: 'result', id: msg.id, ...(r.error ? { error: r.error } : { result: r.result }) });
				return;
			}
		}
	};
}
