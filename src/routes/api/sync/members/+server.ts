import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllMembers } from '$lib/server/thorchain/midgard';

export const POST: RequestHandler = async () => {
	try {
		const result = await syncAllMembers();
		return json(result);
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};
