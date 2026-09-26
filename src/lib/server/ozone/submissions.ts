/**
 * Reports (list an address) and appeals (delisting / false positive).
 * Stored without any request metadata: no IP, no user agent, no cookies.
 * Abuse control is a global in-memory rate limit plus a honeypot field.
 */
import { randomBytes } from 'node:crypto';
import { addressReadings } from '$ozone/index.js';
import { sql } from './sql';

export type SubmissionKind = 'report' | 'appeal';

export class SubmissionError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
let windowStart = 0;
let windowCount = 0;

function throttle() {
	const now = Date.now();
	if (now - windowStart > WINDOW_MS) {
		windowStart = now;
		windowCount = 0;
	}
	if (++windowCount > MAX_PER_WINDOW) throw new SubmissionError('Too many submissions right now, please retry in a minute', 429);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function publicId(): string {
	const bytes = randomBytes(12);
	let s = '';
	for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
	return `OZS-${s}`;
}

const str = (v: unknown, max: number): string | undefined => {
	if (v === undefined || v === null || v === '') return undefined;
	if (typeof v !== 'string') throw new SubmissionError('Invalid field');
	const t = v.trim();
	if (t.length > max) throw new SubmissionError(`Field too long (max ${max} characters)`);
	return t || undefined;
};

export async function createSubmission(raw: unknown): Promise<{ publicId: string; kind: SubmissionKind }> {
	if (!raw || typeof raw !== 'object') throw new SubmissionError('Invalid body');
	const b = raw as Record<string, unknown>;
	if (b.website) throw new SubmissionError('Rejected'); // honeypot
	const kind = b.kind === 'appeal' ? 'appeal' : b.kind === 'report' ? 'report' : null;
	if (!kind) throw new SubmissionError('kind must be "report" or "appeal"');
	const address = str(b.address, 128);
	if (!address) throw new SubmissionError('Address required');
	const chain = str(b.chain, 16);
	const readings = addressReadings(address, chain);
	if (!readings.length) throw new SubmissionError('Not a valid address for a supported chain');
	const message = str(b.message, 4000);
	if (!message || message.length < 10) throw new SubmissionError('Please describe the reason (at least 10 characters)');
	const evidence = str(b.evidence, 2000);
	const contact = str(b.contact, 200);
	throttle();
	const id = publicId();
	await sql.query(
		`INSERT INTO oz_submissions (public_id, kind, address, chain, key, message, evidence, contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		[id, kind, address, readings[0].chain, readings[0].key, message, evidence ?? null, contact ?? null]
	);
	return { publicId: id, kind };
}

export async function getSubmission(id: string) {
	const r = await sql.query<{
		public_id: string;
		kind: string;
		address: string;
		chain: string | null;
		status: string;
		resolution: string | null;
		created_at: string;
		resolved_at: string | null;
	}>(`SELECT public_id, kind, address, chain, status, resolution, created_at, resolved_at FROM oz_submissions WHERE public_id = $1`, [id]);
	const s = r.rows[0];
	if (!s) return null;
	return {
		publicId: s.public_id,
		kind: s.kind,
		address: s.address,
		chain: s.chain,
		status: s.status,
		resolution: s.resolution,
		createdAt: new Date(s.created_at).toISOString(),
		resolvedAt: s.resolved_at ? new Date(s.resolved_at).toISOString() : null
	};
}
