import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const OWNER_EMAIL = 'f@redacted.gg';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { email, name, role } = await request.json();
	if (!email) return json({ error: 'Email required' }, { status: 400 });

	// Only owner can create other owners
	const assignRole = role === 'owner' && locals.user.role === 'owner' ? 'owner' : 'admin';

	// Generate random password
	const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
	let password = '';
	for (let i = 0; i < 16; i++) password += chars[Math.floor(Math.random() * chars.length)];

	try {
		const result = await auth.api.signUpEmail({
			body: { email, password, name: name || email.split('@')[0] }
		});

		if (!result) return json({ error: 'Failed to create user' }, { status: 500 });

		// Set role
		await db.update(user).set({ role: assignRole }).where(eq(user.email, email));

		return json({ email, password, role: assignRole });
	} catch (err: any) {
		return json({ error: err?.message || 'Failed to create user' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { userId } = await request.json();
	if (!userId) return json({ error: 'userId required' }, { status: 400 });

	// Check the target user
	const [target] = await db.select().from(user).where(eq(user.id, userId));
	if (!target) return json({ error: 'User not found' }, { status: 404 });

	// Cannot remove owner
	if (target.role === 'owner') {
		return json({ error: 'Cannot remove owner' }, { status: 403 });
	}

	// Cannot remove yourself
	if (target.id === locals.user.id) {
		return json({ error: 'Cannot remove yourself' }, { status: 403 });
	}

	// Delete the user (cascades to sessions/accounts)
	await db.delete(user).where(eq(user.id, userId));

	return json({ success: true });
};
