import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runPublish, runSources, runUserScreening, syncInApp } from '$lib/server/ozone/jobs';

export const config = { maxDuration: 300 };

/** All list sources → snapshot → THORChain user screening (admin / fallback). */
export const POST: RequestHandler = async () => {
	if (!syncInApp()) return json({ skipped: 'list sync runs in OZONE-WORKER (set OZONE_SYNC_IN_APP=1 to run it here)' }, { status: 202 });
	const start = Date.now();
	const sources = await runSources();
	const snapshot = await runPublish();
	const users = await runUserScreening();
	return json({ duration: Date.now() - start, sources, snapshot, users });
};
