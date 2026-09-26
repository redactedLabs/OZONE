/** GET /api/v1/keys — public keys that sign snapshots and API answers (pin them in node config). */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publishedKeys } from '$lib/server/ozone/keys';

export const GET: RequestHandler = async () => {
	const { snapshot, response } = publishedKeys();
	const fmt = (k: { keyId: string; spec: string }, usage: string) => ({ keyId: k.keyId, alg: 'ed25519', publicKey: k.spec, usage });
	return json(
		{ keys: [...snapshot.map((k) => fmt(k, 'snapshot')), ...response.map((k) => fmt(k, 'response'))] },
		{ headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } }
	);
};
