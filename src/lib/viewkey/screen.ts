/**
 * Every counterparty a view shows, checked against Ozone's lists through its public batch endpoint
 * (`POST /api/v1/screen`, stateless: addresses are neither stored nor logged). Only addresses leave the
 * browser, never the view key or anything derived from it.
 */
import { SCREEN_BATCH, SCREEN_ENDPOINT } from './config';
import type { FetchFn } from './chain';
import { platformFetch } from './chain';

export type Role = 'depositor' | 'payee' | 'slow_recipient' | 'queued_recipient' | 'spending_account' | 'returning_account' | 'exit_address' | 'spending_payee' | 'called_contract';

export interface Reason {
	code: string;
	source: string;
	category: string;
	risk: string;
	text: string;
	entity?: string;
	ref?: string;
	removedAt?: string;
}

export interface Verdict {
	input: string;
	valid: boolean;
	status: 'clean' | 'flagged' | 'invalid';
	risk: string;
	reasons: Reason[];
}

export interface ScreenResult {
	verdicts: Map<string, Verdict>;
	snapshot: { version: number; builtAt: string; sha256: string } | null;
	/** Set when Ozone could not screen (no snapshot, or the request failed). */
	error: string | null;
	signed: boolean;
}

/** Adds `address` with `role` (addresses only: a string that looks like an address of some chain). */
export function addCounterparty(map: Map<string, Set<Role>>, address: unknown, role: Role): void {
	if (typeof address !== 'string') return;
	const a = address.trim();
	if (!a || a.length > 128 || !/^[A-Za-z0-9:._-]+$/.test(a)) return;
	let roles = map.get(a);
	if (!roles) map.set(a, (roles = new Set()));
	roles.add(role);
}

/** Screens the addresses in batches of at most `SCREEN_BATCH`. The body names addresses, nothing else. */
export async function screenAddresses(addresses: string[], fetchFn: FetchFn = platformFetch): Promise<ScreenResult> {
	const verdicts = new Map<string, Verdict>();
	let snapshot: ScreenResult['snapshot'] = null;
	let signed = true;
	const unique = [...new Set(addresses)];
	for (let i = 0; i < unique.length; i += SCREEN_BATCH) {
		const batch = unique.slice(i, i + SCREEN_BATCH);
		let res: Response;
		try {
			res = await fetchFn(SCREEN_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ addresses: batch }),
				credentials: 'omit',
				cache: 'no-store',
				referrerPolicy: 'no-referrer'
			});
		} catch {
			return { verdicts, snapshot, error: 'Ozone could not be reached.', signed: false };
		}
		let body: any = null;
		try {
			body = await res.json();
		} catch {
			/* not JSON */
		}
		if (!res.ok || !body || !Array.isArray(body.results)) {
			return { verdicts, snapshot, error: typeof body?.error === 'string' ? body.error : `Ozone answered ${res.status}.`, signed: false };
		}
		snapshot = body.snapshot ?? snapshot;
		signed = signed && typeof body.signature?.sig === 'string';
		batch.forEach((addr, k) => {
			const v = body.results[k];
			if (v && typeof v === 'object') verdicts.set(addr, v as Verdict);
		});
	}
	return { verdicts, snapshot, error: null, signed: unique.length > 0 && signed };
}

/** The active reasons of a verdict, highest risk first (as Ozone orders them). */
export function activeReasons(v: Verdict | undefined): Reason[] {
	return (v?.reasons ?? []).filter((r) => !r.removedAt);
}
