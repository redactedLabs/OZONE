import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncTether } from '$lib/server/compliance/tether';

async function runTetherSync() {
	const start = Date.now();
	try {
		const result = await syncTether();
		return json({ duration: Date.now() - start, result });
	} catch (e) {
		return json({ duration: Date.now() - start, error: String(e) }, { status: 500 });
	}
}

// GET for Vercel Cron
export const GET: RequestHandler = async () => runTetherSync();

// POST for manual trigger
export const POST: RequestHandler = async () => runTetherSync();
