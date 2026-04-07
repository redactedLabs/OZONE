import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { currentPassword, newPassword } = await request.json();

	if (!currentPassword || !newPassword) {
		return json({ error: 'Current and new password are required' }, { status: 400 });
	}

	if (newPassword.length < 8) {
		return json({ error: 'New password must be at least 8 characters' }, { status: 400 });
	}

	try {
		// Find the credential account for this user
		const [acct] = await db
			.select()
			.from(account)
			.where(and(eq(account.userId, locals.user.id), eq(account.providerId, 'credential')))
			.limit(1);

		if (!acct || !acct.password) {
			return json({ error: 'No credential account found' }, { status: 400 });
		}

		// Verify current password
		const valid = await verifyPassword({ hash: acct.password, password: currentPassword });
		if (!valid) {
			return json({ error: 'Current password is incorrect' }, { status: 403 });
		}

		// Hash and update new password
		const newHash = await hashPassword(newPassword);
		await db
			.update(account)
			.set({ password: newHash, updatedAt: new Date() })
			.where(eq(account.id, acct.id));

		return json({ success: true });
	} catch (e) {
		return json({ error: 'Failed to change password' }, { status: 500 });
	}
};
