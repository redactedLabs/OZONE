/**
 * Incident path, admin side: a maintainer pastes the addresses of a freshly
 * announced hack (with the source URL and a note). They become maintainer
 * flags (manual_flags) with an oz_manual_meta row marking them urgent; the
 * worker notices the change within seconds, lists them, traces them (and
 * whatever they reach) before anything else and publishes a snapshot —
 * minutes instead of the next scheduled sync.
 */
import { httpUrlOrUndefined, URGENT_DEFAULT_MS, type Sql } from '$engine/index.js';
import { normalizeChain, parseListedAddress } from '$ozone/index.js';

export const MAX_INCIDENT_ADDRESSES = 500;

export interface IncidentInput {
	/** One string (addresses separated by whitespace, commas or semicolons; `CHAIN:address` allowed) or a list. */
	addresses: string | string[];
	/** Chain for addresses without a prefix (auto-detected when unset). */
	chain?: string | null;
	/** Why (shown in every verdict). Defaults to the incident name. */
	reason?: string;
	/** Incident name, e.g. "Exchange X hack (2026-09-27)". */
	incident?: string;
	/** Public source (post-mortem, law-enforcement release, investigator thread). http(s) only. */
	refUrl?: string;
	note?: string;
	/** Trace and publish immediately (default true). */
	urgent?: boolean;
	/** How long the flags stay on the incident path (default 48 h, at most 7 days). */
	urgentHours?: number;
}

export interface IncidentOutcome {
	status: number;
	body: {
		error?: string;
		listed?: Array<{ id: number; address: string; chain: string; key: string }>;
		invalid?: string[];
		alreadyFlagged?: string[];
		urgentUntil?: string | null;
		warnings?: string[];
	};
}

function tokens(input: string | string[]): string[] {
	const list = Array.isArray(input) ? input : [input];
	return list.flatMap((s) => String(s ?? '').split(/[\s,;]+/)).map((t) => t.trim()).filter(Boolean);
}

/** `ETH:0xabc…` → chain + address (a bitcoincash: URI is an address, not a prefix). */
function splitPrefix(token: string): { chain?: string; address: string } {
	const i = token.indexOf(':');
	if (i > 0 && i <= 8 && !token.toLowerCase().startsWith('bitcoincash:')) {
		const chain = normalizeChain(token.slice(0, i));
		if (chain) return { chain, address: token.slice(i + 1) };
	}
	return { address: token };
}

export async function addIncidentFlags(sql: Sql, input: IncidentInput, addedBy: string, now = new Date()): Promise<IncidentOutcome> {
	const incident = String(input.incident ?? '').trim().slice(0, 200) || undefined;
	const reason = String(input.reason ?? '').trim().slice(0, 500) || incident;
	if (!reason) return { status: 400, body: { error: 'A reason or an incident name is required' } };
	const refUrl = input.refUrl ? httpUrlOrUndefined(String(input.refUrl).trim()) : undefined;
	if (input.refUrl && !refUrl) return { status: 400, body: { error: 'The source URL must be an http(s) link' } };
	const note = String(input.note ?? '').trim().slice(0, 1000) || undefined;
	const all = tokens(input.addresses ?? []);
	if (!all.length) return { status: 400, body: { error: 'No addresses' } };
	if (all.length > MAX_INCIDENT_ADDRESSES) return { status: 400, body: { error: `At most ${MAX_INCIDENT_ADDRESSES} addresses per request` } };
	const defaultChain = input.chain ? normalizeChain(String(input.chain)) : undefined;
	if (input.chain && !defaultChain) return { status: 400, body: { error: `Unknown chain ${input.chain}` } };

	const invalid: string[] = [];
	const parsed = new Map<string, { address: string; chain: string; key: string }>();
	for (const t of all) {
		const { chain, address } = splitPrefix(t);
		const p = parseListedAddress(address, chain ?? defaultChain ?? null);
		if (!p) {
			invalid.push(t);
			continue;
		}
		if (!parsed.has(p.parsed.key)) parsed.set(p.parsed.key, { address: p.parsed.address, chain: p.parsed.chain, key: p.parsed.key });
	}
	const candidates = [...parsed.values()];
	const existing = candidates.length
		? (
				await sql.query<{ address: string; chain: string | null }>(`SELECT address, chain FROM manual_flags WHERE active = true AND address = ANY($1::text[])`, [
					candidates.map((c) => c.address)
				])
			).rows
		: [];
	const isFlagged = (c: { address: string; chain: string }) => existing.some((e) => e.address === c.address && (!e.chain || e.chain === c.chain));
	const alreadyFlagged = candidates.filter(isFlagged).map((c) => c.address);
	const fresh = candidates.filter((c) => !isFlagged(c));

	const listed: NonNullable<IncidentOutcome['body']['listed']> = [];
	for (const c of fresh) {
		const r = await sql.query<{ id: number }>(`INSERT INTO manual_flags (address, chain, reason, added_by) VALUES ($1, $2, $3, $4) RETURNING id`, [
			c.address,
			c.chain,
			reason,
			addedBy
		]);
		listed.push({ id: Number(r.rows[0].id), ...c });
	}

	const urgent = input.urgent !== false;
	const hours = Math.min(168, Math.max(1, Number(input.urgentHours) || URGENT_DEFAULT_MS / 3600_000));
	const urgentUntil = urgent ? new Date(now.getTime() + hours * 3600_000) : null;
	const warnings: string[] = [];
	if (listed.length) {
		try {
			for (const l of listed) {
				await sql.query(
					`INSERT INTO oz_manual_meta (flag_id, incident, ref_url, note, urgent_until, created_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (flag_id) DO NOTHING`,
					[l.id, incident ?? null, refUrl ?? null, note ?? null, urgentUntil, addedBy]
				);
			}
		} catch (e) {
			// the worker applies migration 0004 on start; until then the flags are
			// listed at the next manual sync, without incident data or priority
			warnings.push(`incident details not stored (${(e as Error).message}); the flags are listed at the next scheduled sync`);
		}
	}
	return { status: 200, body: { listed, invalid, alreadyFlagged, urgentUntil: urgentUntil?.toISOString() ?? null, warnings } };
}
