import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/ozone/sql';

export const load: PageServerLoad = async ({ params }) => {
	const r = await sql.query<{
		cert_id: string;
		address: string;
		flagged: boolean;
		sources_checked: number;
		issued_at: string;
		risk: string | null;
		snapshot_version: string | null;
		document: { reasons?: Array<{ source: string; text: string; risk: string; ref?: string; removedAt?: string }>; signature?: { keyId: string } } | null;
	}>(
		`SELECT cert_id, address, flagged, sources_checked, issued_at, risk, snapshot_version, document FROM certificates WHERE cert_id = $1`,
		[params.id.toUpperCase()]
	);
	const cert = r.rows[0];
	if (!cert) throw error(404, 'Certificate not found');
	return {
		certId: cert.cert_id,
		address: cert.address,
		flagged: cert.flagged,
		sourcesChecked: cert.sources_checked,
		issuedAt: cert.issued_at ? new Date(cert.issued_at).toISOString() : null,
		risk: cert.risk,
		snapshotVersion: cert.snapshot_version ? Number(cert.snapshot_version) : null,
		reasons: (cert.document?.reasons ?? []).filter((x) => !x.removedAt),
		signedBy: cert.document?.signature?.keyId ?? null
	};
};
