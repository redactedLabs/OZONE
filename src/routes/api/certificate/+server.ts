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
import { attachSignature, DOMAIN_CERTIFICATE } from '$ozone/index.js';
import { responseKey } from '$lib/server/ozone/keys';
import { screenItems } from '$lib/server/ozone/screen';
import { currentSnapshot } from '$lib/server/ozone/snapshot';
import { sql } from '$lib/server/ozone/sql';

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

	const res = await screenItems([{ address, chain }]);
	const verdict = res.results[0];
	if (!res.snapshot || !verdict) return json({ error: 'Screening data unavailable' }, { status: 503 });
	if (verdict.status === 'invalid') return json({ error: 'Not a valid address for a supported chain' }, { status: 400 });

	const sources = (await currentSnapshot())?.index.sources ?? [];
	const certId = generateCertId();
	const issuedAt = new Date().toISOString();
	const document = {
		type: 'ozone.certificate.v1',
		certId,
		address,
		keys: verdict.keys,
		status: verdict.status,
		risk: verdict.risk,
		reasons: verdict.reasons.map((r) => ({
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
		[certId, address, verdict.status === 'flagged', sources.length, verdict.chain ?? null, verdict.risk, res.snapshot.version, JSON.stringify(signed)]
	);
	return json({ certId, address, flagged: verdict.status === 'flagged', issuedAt, verdict, certificate: signed });
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
