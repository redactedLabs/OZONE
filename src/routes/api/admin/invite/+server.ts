import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const OWNER_EMAIL = 'f@redacted.gg';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'admin' && locals.user.role !== 'owner') return json({ error: 'Forbidden' }, { status: 403 });

	const { email, name, role } = await request.json();
	if (!email) return json({ error: 'Email required' }, { status: 400 });
	const normalizedEmail = email.toLowerCase();

	// Only owner can create other owners
	const assignRole = role === 'owner' && locals.user.role === 'owner' ? 'owner' : 'admin';

	// Generate random password
	const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
	let password = '';
	for (let i = 0; i < 16; i++) password += chars[Math.floor(Math.random() * chars.length)];

	try {
		// auth.api.signUpEmail() is disabled (better-auth's own
		// EMAIL_PASSWORD_SIGN_UP_DISABLED guard applies to server-side calls
		// too — it isn't only an HTTP-route check). An invited account is
		// created by an admin, not self-registered, so it's created with the
		// same lower-level primitives signUpEmail itself uses internally.
		const ctx = await auth.$context;
		const passwordHash = await ctx.password.hash(password);
		const created = await ctx.internalAdapter.createUser({ email: normalizedEmail, name: name || email.split('@')[0], emailVerified: false });
		if (!created) return json({ error: 'Failed to create user' }, { status: 500 });
		await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: 'credential', accountId: created.id, password: passwordHash });

		// Set role
		await db.update(user).set({ role: assignRole }).where(eq(user.email, normalizedEmail));

		return json({ email: normalizedEmail, password, role: assignRole });
	} catch (err: any) {
		return json({ error: err?.message || 'Failed to create user' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'admin' && locals.user.role !== 'owner') return json({ error: 'Forbidden' }, { status: 403 });

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
