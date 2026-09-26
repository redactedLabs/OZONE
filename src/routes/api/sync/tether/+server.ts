import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runSources, syncInApp } from '$lib/server/ozone/jobs';

export const config = { maxDuration: 300 };

async function run() {
	if (!syncInApp()) return json({ skipped: 'stablecoin freeze sync runs in OZONE-WORKER' }, { status: 202 });
	return json(await runSources(['tether']));
}

export const GET: RequestHandler = async () => run();
export const POST: RequestHandler = async () => run();
