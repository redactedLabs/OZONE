import { auth } from '$lib/server/auth';
import { isAuthorizedAdminRequest } from '$lib/server/request-auth';
import { redirect, type Handle } from '@sveltejs/kit';

// Routes that require authentication (admin only)
const PROTECTED_ROUTES = [
	'/api/sync',
	'/api/sync/members',
	'/api/sync/addresses',
	'/api/sync/compliance',
	'/api/cron',
	'/api/admin',
	'/admin',
];

function isProtectedRoute(routeKey: string): boolean {
	return PROTECTED_ROUTES.some(r => routeKey === r || routeKey.startsWith(r + '/'));
}

/** event.url.pathname, percent-decoded — used only when nothing matched (route.id is null). */
function decodedPathname(pathname: string): string {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	// Always try to get the session
	const sessionData = await auth.api.getSession({
		headers: event.request.headers
	});

	if (sessionData) {
		// Fetch role from DB. Fail closed: a session alone never grants
		// admin/owner authority — only a role read back from the database
		// does, and a lookup error or a missing row must not default to one.
		let role = '';
		try {
			const { db } = await import('$lib/server/db');
			const { user: userTable } = await import('$lib/server/db/schema');
			const { eq } = await import('drizzle-orm');
			const [dbUser] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, sessionData.user.id)).limit(1);
			role = dbUser?.role ?? '';
		} catch { /* fail closed: role stays '' */ }

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

	// Match on the resolved route pattern, not the raw pathname: SvelteKit's
	// router decodes percent-encoding before matching and invoking a route
	// (e.g. /api/%61dmin/transactions dispatches to /api/admin/transactions),
	// but event.url.pathname keeps the client's original encoding — so a
	// string compare against it can classify an encoded protected path as
	// unprotected while the framework still runs the protected handler.
	// route.id is null only when nothing matched (a 404), which is also
	// worth decoding before the (harmless, 404-bound) comparison.
	const routeKey = event.route.id ?? decodedPathname(event.url.pathname);
	if (isProtectedRoute(routeKey) && !isAuthorizedAdminRequest(event.request, event.locals.user)) {
		throw redirect(303, '/login');
	}

	return resolve(event);
};
