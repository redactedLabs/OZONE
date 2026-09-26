/**
 * Ozone snapshot format v1.
 *
 * A snapshot is two files:
 *
 * - the **manifest** (small JSON, Ed25519-signed): version, build time,
 *   SHA-256 and size of the payload, counts;
 * - the **payload** (gzip of canonical JSON): every listed and traced
 *   address with its reasons, sources and provenance.
 *
 * Nodes pin Ozone's public key(s), verify the manifest signature, verify the
 * payload hash against the manifest, refuse versions older than the one they
 * hold (anti-rollback) and then screen locally. Any mirror can serve the two
 * files — authenticity comes from the signature, not from the transport.
 */
import { gunzipSync } from 'node:zlib';
import { addressReadings, normalizeChain, SUPPORTED_CHAINS } from './chains.js';
import { DOMAIN_SNAPSHOT_MANIFEST, verifyAttached, type PublicKeyInfo, type SignatureBlock } from './crypto.js';
import { sha256Hex } from './encoding.js';
import {
	evaluate,
	referenceFor,
	RISKS,
	type Category,
	type Policy,
	type Reason,
	type Risk,
	type SnapshotRef,
	type TraceInfo,
	type Verdict
} from './verdict.js';

export const SNAPSHOT_FORMAT = 'ozone.snapshot.v1';
export const MANIFEST_FORMAT = 'ozone.snapshot.manifest.v1';

export interface SnapshotSourceInfo {
	id: string;
	name: string;
	kind: string;
	url?: string;
	/** Last successful sync of the source (ISO). */
	lastSuccessAt?: string;
	/** Source-side version (publish date, block height, commit, …). */
	version?: string;
	/** Active entries from this source in the snapshot. */
	entries: number;
}

/** A reason with its strings replaced by string-table indices. */
export interface PackedReason {
	s: number; // source index
	c: number; // code
	k: number; // category
	r: number; // risk rank
	t: number; // text
	e?: number; // entity
	n?: number; // chain
	u?: number; // ref url
	i?: number; // ref id
	l?: number; // listedAt (unix seconds)
	f?: number; // firstSeen (unix seconds)
	x?: number; // removedAt (unix seconds)
	tr?: PackedTrace;
}

export interface PackedTrace {
	h: number; // hop
	a: number; // action
	tx: number; // txid
	ht?: number; // height
	d?: number; // date (unix seconds)
	fr: number; // from address
	fc?: number; // from chain
	am?: number; // amount text
	usd?: number; // USD (integer)
	ok: number; // origin key
	os: number; // origin source index
	oe?: number; // origin entity
}

export interface SnapshotPayloadV1 {
	format: typeof SNAPSHOT_FORMAT;
	version: number;
	builtAt: string;
	generator?: string;
	/** Chains this snapshot screens (others are `unsupported_chain`). */
	chains: string[];
	sources: SnapshotSourceInfo[];
	strings: string[];
	/** `[key, reasons]`, strictly sorted by key. */
	records: Array<[string, PackedReason[]]>;
	stats?: Record<string, number>;
}

export interface SnapshotManifestV1 {
	format: typeof MANIFEST_FORMAT;
	version: number;
	builtAt: string;
	payload: {
		sha256: string;
		size: number;
		encoding: 'gzip';
		url: string;
		/**
		 * Present when the payload is served in parts (hosts with a response
		 * size limit): download all, check each hash, concatenate in order.
		 */
		parts?: Array<{ url: string; size: number; sha256: string }>;
	};
	counts: { keys: number; listed: number; traced: number; reasons: number };
	sources: Array<{ id: string; entries: number; lastSuccessAt?: string }>;
	/** Previous snapshot (version + payload hash), for audit chains. */
	prev?: { version: number; sha256: string };
	signature?: SignatureBlock;
}

export class SnapshotError extends Error {
	constructor(
		readonly code:
			| 'bad_manifest'
			| 'bad_signature'
			| 'untrusted_key'
			| 'hash_mismatch'
			| 'too_large'
			| 'bad_payload'
			| 'rollback'
			| 'equivocation'
			| 'expired',
		message: string
	) {
		super(message);
		this.name = 'SnapshotError';
	}
}

const iso = (unix?: number) => (unix ? new Date(unix * 1000).toISOString() : undefined);

function isObj(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Structural check of a manifest + signature verification. */
export function verifyManifest(manifest: unknown, trusted: PublicKeyInfo[]): SnapshotManifestV1 {
	if (!isObj(manifest) || manifest.format !== MANIFEST_FORMAT) {
		throw new SnapshotError('bad_manifest', 'Not an Ozone snapshot manifest');
	}
	const m = manifest as unknown as SnapshotManifestV1;
	if (!Number.isSafeInteger(m.version) || m.version <= 0) throw new SnapshotError('bad_manifest', 'Invalid version');
	if (typeof m.builtAt !== 'string' || Number.isNaN(Date.parse(m.builtAt))) {
		throw new SnapshotError('bad_manifest', 'Invalid builtAt');
	}
	if (
		!isObj(m.payload) ||
		typeof m.payload.sha256 !== 'string' ||
		!/^[0-9a-f]{64}$/.test(m.payload.sha256) ||
		!Number.isSafeInteger(m.payload.size) ||
		m.payload.encoding !== 'gzip' ||
		typeof m.payload.url !== 'string'
	) {
		throw new SnapshotError('bad_manifest', 'Invalid payload descriptor');
	}
	if (m.payload.parts !== undefined) {
		const parts = m.payload.parts;
		if (
			!Array.isArray(parts) ||
			parts.length === 0 ||
			parts.length > 64 ||
			parts.some((p) => !isObj(p) || typeof p.url !== 'string' || !Number.isSafeInteger(p.size) || typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) ||
			parts.reduce((n, p) => n + p.size, 0) !== m.payload.size
		) {
			throw new SnapshotError('bad_manifest', 'Invalid payload parts');
		}
	}
	if (!m.signature) throw new SnapshotError('bad_signature', 'Manifest is not signed');
	if (!trusted.some((k) => k.keyId === m.signature?.keyId)) {
		throw new SnapshotError('untrusted_key', `Manifest signed by untrusted key ${String(m.signature.keyId)}`);
	}
	if (!verifyAttached(DOMAIN_SNAPSHOT_MANIFEST, manifest, trusted)) {
		throw new SnapshotError('bad_signature', 'Manifest signature does not verify');
	}
	return m;
}

export interface DecodeOptions {
	/** Maximum decompressed size (default 512 MiB). */
	maxDecompressedBytes?: number;
}

/** Verifies the payload against a (verified) manifest and builds the index. */
export function decodePayload(manifest: SnapshotManifestV1, bytes: Uint8Array, opts: DecodeOptions = {}): SnapshotIndex {
	if (bytes.length !== manifest.payload.size) {
		throw new SnapshotError('hash_mismatch', `Payload size ${bytes.length} != manifest ${manifest.payload.size}`);
	}
	const digest = sha256Hex(bytes);
	if (digest !== manifest.payload.sha256) throw new SnapshotError('hash_mismatch', 'Payload SHA-256 mismatch');
	let json: string;
	try {
		json = gunzipSync(bytes, { maxOutputLength: opts.maxDecompressedBytes ?? 512 * 1024 * 1024 }).toString('utf8');
	} catch (e) {
		throw new SnapshotError('bad_payload', `Cannot decompress payload: ${(e as Error).message}`);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(json);
	} catch {
		throw new SnapshotError('bad_payload', 'Payload is not JSON');
	}
	const index = SnapshotIndex.fromPayload(payload, digest);
	if (index.version !== manifest.version || index.builtAt !== manifest.builtAt) {
		throw new SnapshotError('bad_payload', 'Payload version/builtAt differ from the manifest');
	}
	index.manifest = manifest;
	return index;
}

export interface ScreenOptions extends Policy {
	/** Current time in ms (for the snapshot age). */
	now?: number;
	/** Age after which verdicts are marked stale (default 24 h). */
	staleAfterMs?: number;
}

/** In-memory lookup structure over a decoded payload. */
export class SnapshotIndex {
	manifest?: SnapshotManifestV1;
	private readonly map = new Map<string, PackedReason[]>();
	readonly chains: Set<string>;

	private constructor(
		readonly payload: SnapshotPayloadV1,
		readonly sha256: string
	) {
		for (const [key, reasons] of payload.records) this.map.set(key, reasons);
		this.chains = new Set(payload.chains);
	}

	static fromPayload(raw: unknown, sha256: string): SnapshotIndex {
		if (!isObj(raw) || raw.format !== SNAPSHOT_FORMAT) throw new SnapshotError('bad_payload', 'Unknown payload format');
		const p = raw as unknown as SnapshotPayloadV1;
		if (!Number.isSafeInteger(p.version) || typeof p.builtAt !== 'string') {
			throw new SnapshotError('bad_payload', 'Invalid payload header');
		}
		if (!Array.isArray(p.strings) || !Array.isArray(p.records) || !Array.isArray(p.sources) || !Array.isArray(p.chains)) {
			throw new SnapshotError('bad_payload', 'Invalid payload body');
		}
		const nStrings = p.strings.length;
		const nSources = p.sources.length;
		const okStr = (i: unknown) => i === undefined || (Number.isInteger(i) && (i as number) >= 0 && (i as number) < nStrings);
		let prev = '';
		for (const rec of p.records) {
			if (!Array.isArray(rec) || rec.length !== 2 || typeof rec[0] !== 'string' || !Array.isArray(rec[1])) {
				throw new SnapshotError('bad_payload', 'Invalid record');
			}
			if (rec[0] <= prev) throw new SnapshotError('bad_payload', 'Records not strictly sorted');
			prev = rec[0];
			for (const r of rec[1]) {
				if (
					!isObj(r) ||
					!Number.isInteger(r.s) ||
					(r.s as number) < 0 ||
					(r.s as number) >= nSources ||
					!okStr(r.c) ||
					!okStr(r.k) ||
					!okStr(r.t) ||
					!okStr(r.e) ||
					!okStr(r.n) ||
					!okStr(r.u) ||
					!okStr(r.i) ||
					!Number.isInteger(r.r) ||
					(r.r as number) < 0 ||
					(r.r as number) >= RISKS.length
				) {
					throw new SnapshotError('bad_payload', `Invalid reason for ${rec[0]}`);
				}
				const tr = r.tr as PackedTrace | undefined;
				if (tr && (!okStr(tr.a) || !okStr(tr.tx) || !okStr(tr.fr) || !okStr(tr.ok) || !okStr(tr.fc) || !okStr(tr.am) || !okStr(tr.oe))) {
					throw new SnapshotError('bad_payload', `Invalid trace for ${rec[0]}`);
				}
			}
		}
		return new SnapshotIndex(p, sha256);
	}

	get version(): number {
		return this.payload.version;
	}

	get builtAt(): string {
		return this.payload.builtAt;
	}

	get size(): number {
		return this.map.size;
	}

	get sources(): SnapshotSourceInfo[] {
		return this.payload.sources;
	}

	has(key: string): boolean {
		return this.map.has(key);
	}

	keys(): IterableIterator<string> {
		return this.map.keys();
	}

	private str(i: number | undefined): string | undefined {
		return i === undefined ? undefined : this.payload.strings[i];
	}

	unpack(key: string, r: PackedReason): Reason {
		const src = this.payload.sources[r.s];
		const reason: Reason = {
			code: this.str(r.c) ?? 'UNKNOWN',
			source: src?.id ?? 'unknown',
			category: (this.str(r.k) ?? 'manual') as Category,
			risk: RISKS[r.r] as Risk,
			text: this.str(r.t) ?? '',
			address: key.slice(key.indexOf(':') + 1)
		};
		const entity = this.str(r.e);
		if (entity) reason.entity = entity;
		const chain = this.str(r.n);
		if (chain) reason.chain = chain;
		const ref = this.str(r.u);
		if (ref) reason.ref = ref;
		const refId = this.str(r.i);
		if (refId) reason.refId = refId;
		if (r.l) reason.listedAt = iso(r.l);
		if (r.f) reason.firstSeen = iso(r.f);
		if (r.x) reason.removedAt = iso(r.x);
		if (r.tr) {
			const t = r.tr;
			const trace: TraceInfo = {
				hop: t.h,
				action: this.str(t.a) ?? 'unknown',
				txid: this.str(t.tx) ?? '',
				from: this.str(t.fr) ?? '',
				originKey: this.str(t.ok) ?? '',
				originSource: this.payload.sources[t.os]?.id ?? 'unknown'
			};
			if (t.ht) trace.height = t.ht;
			if (t.d) trace.date = iso(t.d);
			const fc = this.str(t.fc);
			if (fc) trace.fromChain = fc;
			const am = this.str(t.am);
			if (am) trace.amount = am;
			if (t.usd !== undefined) trace.usd = t.usd;
			const oe = this.str(t.oe);
			if (oe) trace.originEntity = oe;
			reason.trace = trace;
		}
		return reason;
	}

	reasonsForKey(key: string): Reason[] {
		const packed = this.map.get(key);
		return packed ? packed.map((r) => this.unpack(key, r)) : [];
	}

	snapshotRef(now = Date.now(), staleAfterMs = 24 * 3600 * 1000): SnapshotRef {
		const built = Date.parse(this.builtAt);
		const ageMs = Math.max(0, now - built);
		return {
			version: this.version,
			builtAt: this.builtAt,
			sha256: this.sha256,
			ageSeconds: Math.round(ageMs / 1000),
			stale: ageMs > staleAfterMs
		};
	}

	/** Whether this snapshot screens `chainHint` (undefined = auto-detect, always supported). */
	supportsChain(chainHint?: string | null): boolean {
		if (!chainHint) return true;
		const c = normalizeChain(chainHint);
		return !!c && this.chains.has(c);
	}

	/** Screens one address locally. Never throws for bad input: returns status `invalid`. */
	screen(input: string, chainHint?: string | null, opts: ScreenOptions = {}): Verdict {
		const chain = normalizeChain(chainHint);
		const base: Verdict = {
			input,
			...(chain ? { chain } : chainHint ? { chain: String(chainHint) } : {}),
			keys: [],
			valid: false,
			status: 'invalid',
			risk: 'none',
			reasons: [],
			snapshot: this.snapshotRef(opts.now, opts.staleAfterMs)
		};
		if (typeof input !== 'string' || input.length === 0 || input.length > 128) return base;
		if (chainHint && (!chain || !this.chains.has(chain))) return base;
		const readings = addressReadings(input, chain);
		if (!readings.length) return base;
		const keys = [...new Set(readings.map((r) => r.key))];
		const seen = new Set<string>();
		const reasons: Reason[] = [];
		for (const key of keys) {
			for (const r of this.reasonsForKey(key)) {
				const id = `${key}|${r.source}|${r.code}|${r.trace?.txid ?? ''}|${r.refId ?? ''}`;
				if (seen.has(id)) continue;
				seen.add(id);
				reasons.push(r);
			}
		}
		const ev = evaluate(reasons, opts);
		return {
			...base,
			keys,
			valid: true,
			status: ev.status,
			risk: ev.risk,
			reasons: ev.reasons,
			reference: referenceFor(this.version, ev.reasons, ev.status)
		};
	}
}

/** Supported chain list for a payload built by this module version. */
export const DEFAULT_SNAPSHOT_CHAINS: readonly string[] = SUPPORTED_CHAINS;
