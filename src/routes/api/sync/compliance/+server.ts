import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runPublish, runSources, runUserScreening, syncInApp } from '$lib/server/ozone/jobs';
import { isAuthorizedAdminRequest } from '$lib/server/request-auth';

export const config = { maxDuration: 300 };

/**
 * All list sources → snapshot → THORChain user screening (admin / fallback).
 *
 * Defense in depth alongside hooks.server.ts (see
 * ozone-hook-gate-encoded-pathname-bypass) — not itself a cron target, but
 * part of the /api/sync/* family, so kept consistent with its siblings.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!isAuthorizedAdminRequest(request, locals.user)) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!syncInApp()) return json({ skipped: 'list sync runs in OZONE-WORKER (set OZONE_SYNC_IN_APP=1 to run it here)' }, { status: 202 });
	const start = Date.now();
	const sources = await runSources();
	const snapshot = await runPublish();
	const users = await runUserScreening();
	return json({ duration: Date.now() - start, sources, snapshot, users });
};
