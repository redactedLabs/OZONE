import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runSources, syncInApp } from '$lib/server/ozone/jobs';
import { isAuthorizedAdminRequest } from '$lib/server/request-auth';

export const config = { maxDuration: 300 };

async function run() {
	if (!syncInApp()) return json({ skipped: 'stablecoin freeze sync runs in OZONE-WORKER' }, { status: 202 });
	return json(await runSources(['tether']));
}

// Cron target (vercel.json) as well as an admin action — accepts a session
// or CRON_SECRET's bearer token. Defense in depth alongside hooks.server.ts
// (see ozone-hook-gate-encoded-pathname-bypass).
const guard = ({ request, locals }: { request: Request; locals: App.Locals }) =>
	isAuthorizedAdminRequest(request, locals.user) ? null : json({ error: 'Unauthorized' }, { status: 401 });

export const GET: RequestHandler = async (event) => guard(event) ?? run();
export const POST: RequestHandler = async (event) => guard(event) ?? run();
