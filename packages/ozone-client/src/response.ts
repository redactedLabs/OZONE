/**
 * Signed answers of Ozone's online API (`POST /api/v1/screen`). A relayer
 * node can store the signed body as evidence of what Ozone answered.
 */
import { DOMAIN_SCREEN_RESPONSE, parsePublicKey, verifyAttached, type SignatureBlock } from './crypto.js';
import type { Verdict } from './verdict.js';

export const SCREEN_RESPONSE_TYPE = 'ozone.screen.v1';

export interface ScreenResponseV1 {
	type: typeof SCREEN_RESPONSE_TYPE;
	/** Random id of this answer (not linked to the caller). */
	id: string;
	issuedAt: string;
	/** maxTraceHop is present exactly when the caller's policy set it — a verifier can then see it narrowed the results. */
	policy: { flagAt: string; maxTraceHop?: number };
	snapshot: { version: number; builtAt: string; sha256: string } | null;
	results: Verdict[];
	signature?: SignatureBlock;
}

/**
 * Verifies a screen response against pinned API keys. Returns the verified
 * body, or null when the signature is missing, from an unknown key, or does
 * not match.
 */
export function verifyScreenResponse(body: unknown, trustedKeys: string[]): ScreenResponseV1 | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as ScreenResponseV1;
	if (b.type !== SCREEN_RESPONSE_TYPE || !Array.isArray(b.results)) return null;
	const keys = trustedKeys.map(parsePublicKey);
	return verifyAttached(DOMAIN_SCREEN_RESPONSE, body, keys) ? b : null;
}
