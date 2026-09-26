/**
 * Online screening: verdicts from the current snapshot, signed with the API
 * key. Stateless — nothing about the request (addresses, IP, headers) is
 * stored or logged.
 */
import { randomBytes } from 'node:crypto';
import {
	attachSignature,
	DOMAIN_SCREEN_RESPONSE,
	isRisk,
	normalizeChain,
	SCREEN_RESPONSE_TYPE,
	type Policy,
	type Risk,
	type ScreenResponseV1,
	type Verdict
} from '$ozone/index.js';
import { responseKey } from './keys';
import { currentSnapshot } from './snapshot';

export const MAX_BATCH = 100;

export interface ScreenItem {
	address: string;
	chain?: string | null;
}

export class ScreenInputError extends Error {}

export function parseItems(raw: unknown): ScreenItem[] {
	const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { addresses?: unknown }).addresses) ? (raw as { addresses: unknown[] }).addresses : null;
	if (!list) throw new ScreenInputError('Body must be {"addresses": [...]} (strings or {address, chain})');
	if (list.length === 0) throw new ScreenInputError('No addresses');
	if (list.length > MAX_BATCH) throw new ScreenInputError(`At most ${MAX_BATCH} addresses per request`);
	return list.map((x) => {
		if (typeof x === 'string') return { address: x.trim() };
		if (x && typeof x === 'object' && typeof (x as ScreenItem).address === 'string') {
			const it = x as ScreenItem;
			return { address: it.address.trim(), chain: typeof it.chain === 'string' ? it.chain : undefined };
		}
		throw new ScreenInputError('Each item must be a string or {address, chain}');
	});
}

export function parsePolicy(raw: unknown): Policy {
	const p: Policy = {};
	if (raw && typeof raw === 'object') {
		const r = raw as { flagAt?: unknown; maxTraceHop?: unknown };
		if (isRisk(r.flagAt) && r.flagAt !== 'none') p.flagAt = r.flagAt as Risk;
		if (Number.isInteger(r.maxTraceHop) && (r.maxTraceHop as number) >= 0) p.maxTraceHop = r.maxTraceHop as number;
	}
	return p;
}

export async function screenItems(items: ScreenItem[], policy: Policy = {}): Promise<ScreenResponseV1> {
	const snap = await currentSnapshot();
	const now = Date.now();
	const results: Verdict[] = snap
		? items.map((it) => snap.index.screen(it.address, it.chain ? (normalizeChain(it.chain) ?? it.chain) : undefined, { ...policy, now }))
		: [];
	const body: ScreenResponseV1 = {
		type: SCREEN_RESPONSE_TYPE,
		id: randomBytes(12).toString('hex'),
		issuedAt: new Date(now).toISOString(),
		policy: { flagAt: policy.flagAt ?? 'high' },
		snapshot: snap ? { version: snap.index.version, builtAt: snap.index.builtAt, sha256: snap.index.sha256 } : null,
		results
	};
	const key = responseKey();
	return key ? attachSignature(DOMAIN_SCREEN_RESPONSE, body, key) : body;
}

/** The pre-v1 `GET /api/screen` shape (`flagged` + `matches[].source`), kept for existing callers. */
export function legacyVerdict(v: Verdict) {
	return {
		address: v.input,
		flagged: v.status === 'flagged',
		valid: v.valid,
		status: v.status,
		risk: v.risk,
		reference: v.reference,
		matches: v.reasons
			.filter((r) => !r.removedAt)
			.map((r) => ({
				address: r.address,
				chain: r.chain ?? 'UNKNOWN',
				source: r.source,
				category: r.category,
				risk: r.risk,
				entityName: r.entity ?? null,
				reason: r.text,
				ref: r.ref ?? null
			})),
		history: v.reasons.filter((r) => r.removedAt).map((r) => ({ source: r.source, reason: r.text, removedAt: r.removedAt })),
		snapshot: v.snapshot
	};
}
