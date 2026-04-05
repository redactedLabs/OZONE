import { auth } from '$lib/server/auth';
import { redirect, type Handle } from '@sveltejs/kit';

// Routes that require authentication (admin only)
const PROTECTED_ROUTES = [
	'/api/sync',
	'/api/sync/members',
	'/api/sync/addresses',
	'/api/sync/compliance',
	'/api/admin',
	'/admin',
];

// Routes that are always public
const PUBLIC_ROUTES = [
	'/',
	'/addresses',
	'/screening',
	'/login',
	'/api/auth',
	'/api/screen',
	'/api/stats',
];

function isPublicRoute(path: string): boolean {
	return PUBLIC_ROUTES.some(r => path === r || path.startsWith(r + '/'));
}

function isProtectedRoute(path: string): boolean {
	return PROTECTED_ROUTES.some(r => path === r || path.startsWith(r + '/'));
}

export const handle: Handle = async ({ event, resolve }) => {
	// Always try to get the session
	const sessionData = await auth.api.getSession({
		headers: event.request.headers
	});

	if (sessionData) {
		// Fetch role from DB
		let role = 'admin';
		try {
			const { db } = await import('$lib/server/db');
			const { user: userTable } = await import('$lib/server/db/schema');
			const { eq } = await import('drizzle-orm');
			const [dbUser] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, sessionData.user.id)).limit(1);
			if (dbUser?.role) role = dbUser.role;
		} catch { /* fallback to admin */ }

		event.locals.user = {
			id: sessionData.user.id,
			email: sessionData.user.email,
			name: sessionData.user.name,
			role
		};
		event.locals.session = {
			id: sessionData.session.id,
			expiresAt: sessionData.session.expiresAt
		};
	} else {
		event.locals.user = null;
		event.locals.session = null;
	}

	// Only block protected routes if not authenticated
	const path = event.url.pathname;
	if (isProtectedRoute(path) && !event.locals.user) {
		// Allow Vercel Cron with CRON_SECRET
		const authHeader = event.request.headers.get('authorization');
		const cronSecret = process.env.CRON_SECRET;
		if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
			return resolve(event);
		}
		throw redirect(303, '/login');
	}

	return resolve(event);
};
