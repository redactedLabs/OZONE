import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers } from '$lib/server/thorchain/midgard';
import { syncOFAC } from '$lib/server/compliance/ofac';
import { syncEU } from '$lib/server/compliance/eu';
import { syncHackList } from '$lib/server/compliance/hacks';
import { syncTether } from '$lib/server/compliance/tether';
import { screenAllUsers } from '$lib/server/compliance/screener';
import { env } from '$env/dynamic/private';

async function runSync() {
	const start = Date.now();
	const results: Record<string, any> = {};
	const errors: string[] = [];

	// Step 1: Fetch all members (fast — single API call)
	try {
		results.members = await syncAllMembers();
	} catch (e) {
		errors.push(`Members: ${e}`);
		results.members = { error: String(e) };
	}

	// Step 2: Compliance lists (can be slow)
	try {
		results.hacks = await syncHackList();
	} catch (e) {
		errors.push(`Hacks: ${e}`);
	}

	try {
		results.ofac = await syncOFAC();
	} catch (e) {
		errors.push(`OFAC: ${e}`);
	}

	try {
		results.eu = await syncEU();
	} catch (e) {
		errors.push(`EU: ${e}`);
	}

	try {
		results.tether = await syncTether();
	} catch (e) {
		errors.push(`Tether: ${e}`);
	}

	// Step 3: Screen
	try {
		results.screening = await screenAllUsers();
	} catch (e) {
		errors.push(`Screening: ${e}`);
	}

	return json({
		duration: Date.now() - start,
		results,
		errors: errors.length > 0 ? errors : undefined
	});
}

// GET for Vercel Cron
export const GET: RequestHandler = async () => runSync();

// POST for manual trigger
export const POST: RequestHandler = async () => runSync();
