/** GET /api/v1/submissions/<id> — status of a report or appeal (the id is the only key). */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSubmission } from '$lib/server/ozone/submissions';

export const GET: RequestHandler = async ({ params }) => {
	const s = await getSubmission(params.id.toUpperCase());
	if (!s) return json({ error: 'Not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
	return json(s, { headers: { 'cache-control': 'no-store' } });
};
