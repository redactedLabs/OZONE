import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncOFAC } from '$lib/server/compliance/ofac';
import { syncEU } from '$lib/server/compliance/eu';
import { syncHackList } from '$lib/server/compliance/hacks';
import { syncTether } from '$lib/server/compliance/tether';
import { screenAllUsers } from '$lib/server/compliance/screener';

/**
 * Runs compliance list sync (OFAC + EU + Hacks + Tether) then screens all users.
 */
export const POST: RequestHandler = async () => {
	const start = Date.now();
	const results: Record<string, any> = {};
	const errors: string[] = [];

	try {
		results.ofac = await syncOFAC();
	} catch (e) {
		errors.push(`OFAC: ${e}`);
		results.ofac = { error: String(e) };
	}

	try {
		results.eu = await syncEU();
	} catch (e) {
		errors.push(`EU: ${e}`);
		results.eu = { error: String(e) };
	}

	try {
		results.hacks = await syncHackList();
	} catch (e) {
		errors.push(`Hacks: ${e}`);
		results.hacks = { error: String(e) };
	}

	try {
		results.tether = await syncTether();
	} catch (e) {
		errors.push(`Tether: ${e}`);
		results.tether = { error: String(e) };
	}

	try {
		results.screening = await screenAllUsers();
	} catch (e) {
		errors.push(`Screening: ${e}`);
		results.screening = { error: String(e) };
	}

	return json({
		duration: Date.now() - start,
		results,
		errors: errors.length > 0 ? errors : undefined
	});
};
