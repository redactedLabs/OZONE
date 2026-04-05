import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, url }) => {
	// Don't redirect if logging out
	const isLoggingOut = url.searchParams.get('logout') === '1';

	// If already logged in and NOT logging out, redirect to dashboard
	if (locals.user && !isLoggingOut) {
		throw redirect(303, '/');
	}
	return {};
};
