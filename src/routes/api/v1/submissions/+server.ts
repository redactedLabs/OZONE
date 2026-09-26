/** POST /api/v1/submissions — report an address or appeal a flag. No request metadata is stored. */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSubmission, SubmissionError } from '$lib/server/ozone/submissions';

export const POST: RequestHandler = async ({ request }) => {
	const headers = { 'cache-control': 'no-store' };
	try {
		const text = await request.text();
		if (text.length > 16 * 1024) return json({ error: 'Request too large' }, { status: 413, headers });
		const res = await createSubmission(JSON.parse(text));
		return json({ ...res, statusUrl: `/submit/${res.publicId}` }, { status: 201, headers });
	} catch (e) {
		if (e instanceof SubmissionError) return json({ error: e.message }, { status: e.status, headers });
		if (e instanceof SyntaxError) return json({ error: 'Invalid JSON' }, { status: 400, headers });
		return json({ error: 'Could not store the submission' }, { status: 500, headers });
	}
};
