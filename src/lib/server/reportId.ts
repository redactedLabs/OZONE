import { randomBytes } from 'node:crypto';

// A report id is the sole access control for an unauthenticated, shareable
// report (POST /api/history returns shareUrl: /report/<id>; anyone with it can
// read it back). Math.random() is V8's non-cryptographic xorshift128+
// generator — wrong for a capability token — so this uses crypto.randomBytes,
// like the public submission id (lib/server/ozone/submissions.ts). It lives
// here because SvelteKit route files may only export request handlers.
// 256 is a multiple of the alphabet's 32 letters, so there is no modulo bias.
const REPORT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReportId(): string {
	let id = '';
	for (const b of randomBytes(10)) id += REPORT_ID_ALPHABET[b % REPORT_ID_ALPHABET.length];
	return id;
}
