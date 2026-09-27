/**
 * Proof-of-innocence certificates.
 *
 * POST {address, chain?} — Ozone screens the address itself (the verdict is
 * never taken from the caller), stores the result and returns a certificate
 * document signed with the API key (`ozone.certificate.v1`).
 * GET ?id=OZ-… — the stored certificate.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';
import { attachSignature, DOMAIN_CERTIFICATE, evaluate, type Reason } from '$ozone/index.js';
import { responseKey } from '$lib/server/ozone/keys';
import { screenItems } from '$lib/server/ozone/screen';
import { currentSnapshot } from '$lib/server/ozone/snapshot';
import { sql } from '$lib/server/ozone/sql';
import { globalThrottle } from '$lib/server/ozone/throttle';

const allowIssue = globalThrottle(60);

function generateCertId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for (const b of randomBytes(8)) id += chars[b % chars.length];
	return `OZ-${id}`;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: { address?: unknown; chain?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const address = typeof body.address === 'string' ? body.address.trim() : '';
	if (!address || address.length > 128) return json({ error: 'Missing address' }, { status: 400 });
	const chain = typeof body.chain === 'string' ? body.chain : undefined;
	if (!allowIssue()) return json({ error: 'Too many certificates right now, please retry in a minute' }, { status: 429 });

	// A chain hint only narrows addressReadings() to that one reading of the
	// string (SnapshotIndex.screen). Screening the hinted AND the unhinted
	// readings and flagging on either closes the gap where a caller could
	// pick an unlisted reading (e.g. a BTC P2SH string read as LTC) to get a
	// clean certificate for an address Ozone itself flags under another
	// chain — the issuing UI never sends a hint, so this only affects
	// direct API callers, which is exactly who could exploit it.
	const res = await screenItems([{ address, chain }, { address }]);
	const [hinted, unhinted] = res.results;
	if (!res.snapshot || !hinted || !unhinted) return json({ error: 'Screening data unavailable' }, { status: 503 });
	const verdicts = [hinted, unhinted].filter((v) => v.valid);
	if (!verdicts.length) return json({ error: 'Not a valid address for a supported chain' }, { status: 400 });

	const keys = [...new Set(verdicts.flatMap((v) => v.keys))];
	const seen = new Set<string>();
	const reasons: Reason[] = [];
	for (const v of verdicts) {
		for (const r of v.reasons) {
			const id = `${r.source}|${r.code}|${r.trace?.txid ?? ''}|${r.refId ?? ''}|${r.chain ?? ''}`;
			if (seen.has(id)) continue;
			seen.add(id);
			reasons.push(r);
		}
	}
	// Re-evaluating the merged reason set (rather than OR-ing each verdict's
	// own status) keeps risk/reasons self-consistent with status: a reading
	// that only shows up unhinted must still explain a flagged certificate.
	const merged = evaluate(reasons, {});
	const certifiedChain = hinted.valid ? hinted.chain : undefined;
	const verdict = { ...(hinted.valid ? hinted : unhinted), status: merged.status, risk: merged.risk, reasons: merged.reasons, keys };

	const sources = (await currentSnapshot())?.index.sources ?? [];
	const certId = generateCertId();
	const issuedAt = new Date().toISOString();
	const document = {
		type: 'ozone.certificate.v1',
		certId,
		address,
		...(certifiedChain ? { chain: certifiedChain } : {}),
		keys,
		status: merged.status,
		risk: merged.risk,
		reasons: merged.reasons.map((r) => ({
			code: r.code,
			source: r.source,
			category: r.category,
			risk: r.risk,
			text: r.text,
			...(r.ref ? { ref: r.ref } : {}),
			...(r.removedAt ? { removedAt: r.removedAt } : {})
		})),
		snapshot: res.snapshot,
		sourcesChecked: sources.map((s) => s.id),
		issuedAt
	};
	const key = responseKey();
	const signed = key ? attachSignature(DOMAIN_CERTIFICATE, document, key) : document;
	await sql.query(
		`INSERT INTO certificates (cert_id, address, flagged, sources_checked, chain, risk, snapshot_version, document)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		[certId, address, merged.status === 'flagged', sources.length, certifiedChain ?? null, merged.risk, res.snapshot.version, JSON.stringify(signed)]
	);
	return json({ certId, address, flagged: merged.status === 'flagged', issuedAt, verdict, certificate: signed });
};

export const GET: RequestHandler = async ({ url }) => {
	const certId = url.searchParams.get('id');
	if (!certId) return json({ error: 'Missing id parameter' }, { status: 400 });
	const r = await sql.query<{ cert_id: string; address: string; flagged: boolean; sources_checked: number; issued_at: string; document: unknown }>(
		`SELECT cert_id, address, flagged, sources_checked, issued_at, document FROM certificates WHERE cert_id = $1`,
		[certId.toUpperCase()]
	);
	const cert = r.rows[0];
	if (!cert) return json({ error: 'Certificate not found' }, { status: 404 });
	return json({
		certId: cert.cert_id,
		address: cert.address,
		flagged: cert.flagged,
		issuedAt: new Date(cert.issued_at).toISOString(),
		certificate: cert.document ?? null
	});
};
