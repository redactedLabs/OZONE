import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers } from '$lib/server/thorchain/midgard';
import { isAuthorizedAdminRequest } from '$lib/server/request-auth';

// Defense in depth alongside hooks.server.ts (see
// ozone-hook-gate-encoded-pathname-bypass) — not itself a cron target, but
// part of the /api/sync/* family, so kept consistent with its siblings.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!isAuthorizedAdminRequest(request, locals.user)) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const result = await syncAllMembers();
		return json(result);
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};
