/**
 * Snapshot builder (the counterpart of `snapshot.ts`). Ozone's worker uses
 * it to publish snapshots; anyone can use it to build and sign their own
 * (e.g. a node operator's private additions) — nodes only accept snapshots
 * signed by keys they pin.
 */
import { gzipSync } from 'node:zlib';
import { canonicalJson } from './canonical.js';
import { attachSignature, DOMAIN_SNAPSHOT_MANIFEST, type PrivateKeyInfo } from './crypto.js';
import { sha256Hex } from './encoding.js';
import {
	DEFAULT_SNAPSHOT_CHAINS,
	MANIFEST_FORMAT,
	SNAPSHOT_FORMAT,
	type PackedReason,
	type PackedTrace,
	type SnapshotManifestV1,
	type SnapshotPayloadV1,
	type SnapshotSourceInfo
} from './snapshot.js';
import { riskRank, type Reason } from './verdict.js';

export interface BuildInput {
	/** Strictly increasing snapshot version (e.g. unix seconds of the build). */
	version: number;
	builtAt: string;
	generator?: string;
	chains?: readonly string[];
	sources: SnapshotSourceInfo[];
	records: Iterable<{ key: string; reasons: Reason[] }>;
	stats?: Record<string, number>;
	/** Payload URL written into the manifest (relative to the manifest URL). Default `./<version>`. */
	payloadUrl?: string;
	prev?: { version: number; sha256: string };
}

export interface BuiltSnapshot {
	manifest: SnapshotManifestV1;
	payload: Uint8Array;
	json: SnapshotPayloadV1;
}

const unix = (iso?: string): number | undefined => {
	if (!iso) return undefined;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
};

/** Packs, compresses and hashes the payload; signs the manifest when a key is given. */
export function buildSnapshot(input: BuildInput, signingKey?: PrivateKeyInfo): BuiltSnapshot {
	const strings: string[] = [];
	const stringIdx = new Map<string, number>();
	const s = (v: string | undefined): number | undefined => {
		if (v === undefined || v === '') return undefined;
		let i = stringIdx.get(v);
		if (i === undefined) {
			i = strings.length;
			strings.push(v);
			stringIdx.set(v, i);
		}
		return i;
	};
	const sourceIdx = new Map(input.sources.map((src, i) => [src.id, i]));
	const srcOf = (id: string): number => {
		const i = sourceIdx.get(id);
		if (i === undefined) throw new Error(`buildSnapshot: reason from unknown source ${id}`);
		return i;
	};

	const merged = new Map<string, Reason[]>();
	for (const rec of input.records) {
		const list = merged.get(rec.key);
		if (list) list.push(...rec.reasons);
		else merged.set(rec.key, [...rec.reasons]);
	}

	let listed = 0;
	let traced = 0;
	let reasonCount = 0;
	const records: Array<[string, PackedReason[]]> = [];
	for (const key of [...merged.keys()].sort()) {
		const reasons = merged.get(key)!;
		// stable, meaningful order inside a record
		reasons.sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.code.localeCompare(b.code));
		const packed: PackedReason[] = [];
		const seen = new Set<string>();
		let hasListed = false;
		let hasTraced = false;
		for (const r of reasons) {
			const id = `${r.source}|${r.code}|${r.trace?.txid ?? ''}|${r.refId ?? ''}|${r.chain ?? ''}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const p: PackedReason = {
				s: srcOf(r.source),
				c: s(r.code)!,
				k: s(r.category)!,
				r: riskRank(r.risk),
				t: s(r.text) ?? s('-')!
			};
			const e = s(r.entity);
			if (e !== undefined) p.e = e;
			const n = s(r.chain);
			if (n !== undefined) p.n = n;
			const u = s(r.ref);
			if (u !== undefined) p.u = u;
			const i = s(r.refId);
			if (i !== undefined) p.i = i;
			const l = unix(r.listedAt);
			if (l) p.l = l;
			const f = unix(r.firstSeen);
			if (f) p.f = f;
			const x = unix(r.removedAt);
			if (x) p.x = x;
			if (r.trace) {
				const t = r.trace;
				const tr: PackedTrace = {
					h: t.hop,
					a: s(t.action)!,
					tx: s(t.txid) ?? s('-')!,
					fr: s(t.from) ?? s('-')!,
					ok: s(t.originKey) ?? s('-')!,
					os: srcOf(t.originSource)
				};
				if (t.height) tr.ht = t.height;
				const d = unix(t.date);
				if (d) tr.d = d;
				const fc = s(t.fromChain);
				if (fc !== undefined) tr.fc = fc;
				const am = s(t.amount);
				if (am !== undefined) tr.am = am;
				if (t.usd !== undefined && Number.isFinite(t.usd)) tr.usd = Math.round(t.usd);
				const oe = s(t.originEntity);
				if (oe !== undefined) tr.oe = oe;
				p.tr = tr;
				hasTraced = true;
			} else {
				hasListed = true;
			}
			packed.push(p);
		}
		if (!packed.length) continue;
		reasonCount += packed.length;
		if (hasListed) listed++;
		if (hasTraced && !hasListed) traced++;
		records.push([key, packed]);
	}

	const json: SnapshotPayloadV1 = {
		format: SNAPSHOT_FORMAT,
		version: input.version,
		builtAt: input.builtAt,
		...(input.generator ? { generator: input.generator } : {}),
		chains: [...(input.chains ?? DEFAULT_SNAPSHOT_CHAINS)],
		sources: input.sources,
		strings,
		records,
		...(input.stats ? { stats: input.stats } : {})
	};
	const payload = new Uint8Array(gzipSync(Buffer.from(canonicalJson(json), 'utf8'), { level: 9 }));
	const unsigned: SnapshotManifestV1 = {
		format: MANIFEST_FORMAT,
		version: input.version,
		builtAt: input.builtAt,
		payload: {
			sha256: sha256Hex(payload),
			size: payload.length,
			encoding: 'gzip',
			url: input.payloadUrl ?? `./${input.version}`
		},
		counts: { keys: records.length, listed, traced, reasons: reasonCount },
		sources: input.sources.map((src) => ({
			id: src.id,
			entries: src.entries,
			...(src.lastSuccessAt ? { lastSuccessAt: src.lastSuccessAt } : {})
		})),
		...(input.prev ? { prev: input.prev } : {})
	};
	const manifest = signingKey ? attachSignature(DOMAIN_SNAPSHOT_MANIFEST, unsigned, signingKey) : unsigned;
	return { manifest, payload, json };
}
