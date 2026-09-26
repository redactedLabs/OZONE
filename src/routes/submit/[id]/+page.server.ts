import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getSubmission } from '$lib/server/ozone/submissions';

export const load: PageServerLoad = async ({ params }) => {
	const s = await getSubmission(params.id.toUpperCase());
	if (!s) throw error(404, 'Submission not found');
	return { submission: s };
};
