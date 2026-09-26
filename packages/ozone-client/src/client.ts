/**
 * Node-local Ozone client: keeps the newest verified snapshot in memory (and
 * on disk), refreshes it from one or more mirrors, and screens addresses
 * locally — no request to Ozone at screening time, no address ever leaves
 * the node.
 *
 * When every mirror is down the client keeps screening against the last
 * verified snapshot; each verdict carries the snapshot version and age so the
 * caller can apply its own staleness policy.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePublicKey, type PublicKeyInfo } from './crypto.js';
import { sha256Hex } from './encoding.js';
import {
	decodePayload,
	SnapshotError,
	verifyManifest,
	type ScreenOptions,
	type SnapshotIndex,
	type SnapshotManifestV1
} from './snapshot.js';
import type { Policy, Verdict } from './verdict.js';

export const DEFAULT_MANIFEST_URL = 'https://ozone.redacted.gg/api/v1/snapshot';

export interface OzoneClientOptions {
	/** Pinned Ozone snapshot keys, e.g. `ed25519:<base64>`. At least one. */
	trustedKeys: string[];
	/** Manifest URLs, tried in order (mirrors welcome). */
	manifestUrls?: string[];
	/** Directory for the last verified snapshot (survives restarts). */
	cacheDir?: string;
	fetch?: typeof fetch;
	/** Per-request timeout (default 30 s). */
	timeoutMs?: number;
	/** Auto-refresh period for `start()` (default 10 min). */
	refreshIntervalMs?: number;
	/** Largest payload accepted (default 64 MiB). */
	maxPayloadBytes?: number;
	/** Refuse snapshots built more than this long ago (default: accept any age, verdicts carry it). */
	rejectOlderThanMs?: number;
	/** Verdicts older than this are marked `stale` (default 24 h). */
	staleAfterMs?: number;
	/** Default screening policy (flag at `high`). */
	policy?: Policy;
	clock?: () => number;
	/** Observability hook. Events never contain screened addresses. */
	onEvent?: (event: OzoneClientEvent) => void;
}

export type OzoneClientEvent =
	| { type: 'loaded'; source: 'cache' | 'network' | 'bytes'; version: number; builtAt: string; keys: number }
	| { type: 'unchanged'; version: number }
	| { type: 'refresh_failed'; url: string; error: string; code?: string }
	| { type: 'rejected'; url: string; code: string; error: string };

/** What the relayer node's `OzoneSnapshotSource.info()` expects. */
export interface SnapshotInfo {
	version: string;
	/** Build time, ms since epoch. */
	createdAt: number;
	sha256?: string;
}

export class OzoneUnavailableError extends Error {
	constructor(message = 'No verified Ozone snapshot is loaded') {
		super(message);
		this.name = 'OzoneUnavailableError';
	}
}

const MAX_MANIFEST_BYTES = 256 * 1024;

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
	const declared = Number(res.headers.get('content-length') ?? '');
	if (Number.isFinite(declared) && declared > limit) throw new SnapshotError('too_large', 'Response too large');
	if (!res.body) {
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf.length > limit) throw new SnapshotError('too_large', 'Response too large');
		return buf;
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel().catch(() => undefined);
			throw new SnapshotError('too_large', 'Response too large');
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

export class OzoneClient {
	private current?: SnapshotIndex;
	private readonly trusted: PublicKeyInfo[];
	private readonly urls: string[];
	private readonly fetchImpl: typeof fetch;
	private readonly clock: () => number;
	private timer?: ReturnType<typeof setInterval>;
	private refreshing?: Promise<boolean>;
	lastError?: string;
	lastRefreshAt?: number;

	constructor(private readonly opts: OzoneClientOptions) {
		if (!opts.trustedKeys?.length) throw new Error('OzoneClient needs at least one trusted key');
		this.trusted = opts.trustedKeys.map(parsePublicKey);
		this.urls = opts.manifestUrls?.length ? [...opts.manifestUrls] : [DEFAULT_MANIFEST_URL];
		for (const u of this.urls) {
			const url = new URL(u);
			const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
			if (url.protocol !== 'https:' && !local && url.protocol !== 'file:') {
				throw new Error(`Snapshot URL must be https (or local http): ${u}`);
			}
		}
		this.fetchImpl = opts.fetch ?? fetch;
		this.clock = opts.clock ?? Date.now;
	}

	private cacheTried = false;

	/** Loads the cached snapshot (if any, re-verified), then tries one refresh. */
	async init(): Promise<void> {
		await this.loadCacheOnce();
		await this.refresh().catch(() => undefined);
	}

	/** Loads the verified on-disk snapshot once (no-op without `cacheDir`). */
	async loadCacheOnce(): Promise<boolean> {
		if (this.cacheTried) return !!this.current;
		this.cacheTried = true;
		try {
			await this.loadCache();
		} catch {
			/* no or unusable cache: the network refresh decides */
		}
		return !!this.current;
	}

	/** The loaded snapshot, if any. */
	get snapshot(): SnapshotIndex | undefined {
		return this.current;
	}

	info(): SnapshotInfo | undefined {
		const s = this.current;
		return s ? { version: String(s.version), createdAt: Date.parse(s.builtAt), sha256: s.sha256 } : undefined;
	}

	/** Loads a snapshot from bytes (air-gapped delivery, tests). */
	loadFromBytes(manifestJson: string | object, payload: Uint8Array): SnapshotIndex {
		const manifest = verifyManifest(typeof manifestJson === 'string' ? JSON.parse(manifestJson) : manifestJson, this.trusted);
		this.checkMonotonic(manifest);
		const index = decodePayload(manifest, payload);
		this.accept(index, 'bytes');
		return index;
	}

	private checkMonotonic(manifest: SnapshotManifestV1): 'newer' | 'same' {
		const cur = this.current;
		if (cur) {
			if (manifest.version < cur.version) {
				throw new SnapshotError('rollback', `Snapshot ${manifest.version} is older than loaded ${cur.version}`);
			}
			if (manifest.version === cur.version) {
				if (manifest.payload.sha256 !== cur.sha256) {
					throw new SnapshotError('equivocation', `Two different payloads for version ${manifest.version}`);
				}
				return 'same';
			}
		}
		const maxAge = this.opts.rejectOlderThanMs;
		if (maxAge !== undefined && this.clock() - Date.parse(manifest.builtAt) > maxAge) {
			throw new SnapshotError('expired', `Snapshot ${manifest.version} is older than the accepted age`);
		}
		return 'newer';
	}

	private accept(index: SnapshotIndex, source: 'cache' | 'network' | 'bytes') {
		this.current = index;
		this.opts.onEvent?.({ type: 'loaded', source, version: index.version, builtAt: index.builtAt, keys: index.size });
	}

	private async loadCache(): Promise<void> {
		const dir = this.opts.cacheDir;
		if (!dir) return;
		const manifestText = await readFile(join(dir, 'manifest.json'), 'utf8');
		const manifest = verifyManifest(JSON.parse(manifestText), this.trusted);
		const payload = new Uint8Array(await readFile(join(dir, `payload-${manifest.version}.json.gz`)));
		this.checkMonotonic(manifest);
		this.accept(decodePayload(manifest, payload), 'cache');
	}

	private async persist(manifest: SnapshotManifestV1, payload: Uint8Array): Promise<void> {
		const dir = this.opts.cacheDir;
		if (!dir) return;
		await mkdir(dir, { recursive: true });
		const pfile = join(dir, `payload-${manifest.version}.json.gz`);
		await writeFile(pfile + '.tmp', payload);
		await rename(pfile + '.tmp', pfile);
		const mfile = join(dir, 'manifest.json');
		await writeFile(mfile + '.tmp', JSON.stringify(manifest));
		await rename(mfile + '.tmp', mfile);
	}

	private async fetchWithTimeout(url: string, limit: number): Promise<Uint8Array> {
		if (url.startsWith('file:')) {
			const bytes = new Uint8Array(await readFile(new URL(url)));
			if (bytes.length > limit) throw new SnapshotError('too_large', 'File too large');
			return bytes;
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
		try {
			const res = await this.fetchImpl(url, {
				signal: controller.signal,
				redirect: 'follow',
				headers: { accept: 'application/json, application/gzip, application/octet-stream' }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await readLimited(res, limit);
		} finally {
			clearTimeout(timer);
		}
	}

	/** The payload bytes, from one URL or from parts (each part hash-checked). */
	private async fetchPayload(manifest: SnapshotManifestV1, manifestUrl: string): Promise<Uint8Array> {
		const limit = this.opts.maxPayloadBytes ?? 64 * 1024 * 1024;
		if (manifest.payload.size > limit) throw new SnapshotError('too_large', 'Snapshot larger than maxPayloadBytes');
		const parts = manifest.payload.parts;
		if (!parts?.length) return this.fetchWithTimeout(new URL(manifest.payload.url, manifestUrl).toString(), limit);
		const out = new Uint8Array(manifest.payload.size);
		let offset = 0;
		for (const part of parts) {
			const bytes = await this.fetchWithTimeout(new URL(part.url, manifestUrl).toString(), part.size);
			if (bytes.length !== part.size || sha256Hex(bytes) !== part.sha256) {
				throw new SnapshotError('hash_mismatch', 'Snapshot part hash mismatch');
			}
			out.set(bytes, offset);
			offset += bytes.length;
		}
		return out;
	}

	/**
	 * Fetches the newest manifest from the first mirror that answers with a
	 * valid one; downloads and verifies the payload when it is newer.
	 * Resolves true when a newer snapshot was loaded, false when unchanged.
	 * Throws when no mirror produced a verifiable answer (the current
	 * snapshot stays loaded).
	 */
	refresh(): Promise<boolean> {
		this.refreshing ??= this.doRefresh().finally(() => {
			this.refreshing = undefined;
		});
		return this.refreshing;
	}

	private async doRefresh(): Promise<boolean> {
		const errors: string[] = [];
		for (const url of this.urls) {
			try {
				const manifestBytes = await this.fetchWithTimeout(url, MAX_MANIFEST_BYTES);
				const manifest = verifyManifest(JSON.parse(Buffer.from(manifestBytes).toString('utf8')), this.trusted);
				if (this.checkMonotonic(manifest) === 'same') {
					this.lastRefreshAt = this.clock();
					this.lastError = undefined;
					this.opts.onEvent?.({ type: 'unchanged', version: manifest.version });
					return false;
				}
				const payload = await this.fetchPayload(manifest, url);
				const index = decodePayload(manifest, payload);
				this.accept(index, 'network');
				this.lastRefreshAt = this.clock();
				this.lastError = undefined;
				await this.persist(manifest, payload).catch((e) => {
					errors.push(`persist: ${(e as Error).message}`);
				});
				return true;
			} catch (e) {
				const err = e as Error & { code?: string };
				const msg = err.message || String(e);
				errors.push(`${url}: ${msg}`);
				if (e instanceof SnapshotError) this.opts.onEvent?.({ type: 'rejected', url, code: e.code, error: msg });
				else this.opts.onEvent?.({ type: 'refresh_failed', url, error: msg });
			}
		}
		this.lastError = errors.join('; ');
		throw new Error(`Ozone snapshot refresh failed: ${this.lastError}`);
	}

	/** Loads the cache and refreshes now, then periodically (timer is unref'd). */
	start(): void {
		if (this.timer) return;
		void this.loadCacheOnce().then(() => this.refresh().catch(() => undefined));
		const period = this.opts.refreshIntervalMs ?? 10 * 60 * 1000;
		this.timer = setInterval(() => {
			this.refresh().catch(() => undefined);
		}, period);
		(this.timer as { unref?: () => void }).unref?.();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	/** Screens one address against the loaded snapshot. Throws OzoneUnavailableError without one. */
	screen(address: string, chain?: string | null, options: ScreenOptions = {}): Verdict {
		const snap = this.current;
		if (!snap) throw new OzoneUnavailableError();
		return snap.screen(address, chain, {
			...this.opts.policy,
			staleAfterMs: this.opts.staleAfterMs,
			now: this.clock(),
			...options
		});
	}

	screenMany(items: Array<string | { address: string; chain?: string | null }>, options: ScreenOptions = {}): Verdict[] {
		return items.map((it) => (typeof it === 'string' ? this.screen(it, undefined, options) : this.screen(it.address, it.chain, options)));
	}
}

/**
 * The relayer node's `OzoneSnapshotSource` (relayer-node
 * `src/v2/screening/snapshot.ts`), backed by an OzoneClient.
 */
export interface RelayerSnapshotSource {
	info(): SnapshotInfo | undefined;
	lookup(query: { address: string; chain: string }): { status: 'clean' | 'flagged'; reference?: string } | { status: 'unsupported_chain' };
	refresh(): Promise<void>;
	start(): void;
	stop(): void;
}

export function createOzoneSnapshotSource(clientOrOptions: OzoneClient | OzoneClientOptions): RelayerSnapshotSource {
	const client = clientOrOptions instanceof OzoneClient ? clientOrOptions : new OzoneClient(clientOrOptions);
	return {
		info: () => client.info(),
		lookup(query) {
			const snap = client.snapshot;
			if (!snap) throw new OzoneUnavailableError();
			if (!snap.supportsChain(query.chain)) return { status: 'unsupported_chain' };
			const v = client.screen(query.address, query.chain);
			if (v.status === 'invalid') return { status: 'unsupported_chain' };
			return v.reference ? { status: v.status, reference: v.reference } : { status: v.status };
		},
		refresh: async () => {
			// first call: the verified on-disk snapshot is available even if every mirror is down
			await client.loadCacheOnce();
			await client.refresh();
		},
		start: () => client.start(),
		stop: () => client.stop()
	};
}
