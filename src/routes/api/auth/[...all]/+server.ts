import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { toSvelteKitHandler } from 'better-auth/svelte-kit';

export const GET: RequestHandler = toSvelteKitHandler(auth);
export const POST: RequestHandler = toSvelteKitHandler(auth);
