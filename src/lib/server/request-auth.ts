/**
 * Whether an admin/cron-only request may proceed: either an authenticated
 * session (any role — per-endpoint role checks, where they apply, run
 * separately) or Vercel Cron's own bearer token.
 *
 * hooks.server.ts's route gate calls this, and so does every route below it
 * that must not rely on the gate alone (see ozone-hook-gate-encoded-pathname-
 * bypass: a routing quirk in one layer must not be a bypass of the other).
 */
export function isAuthorizedAdminRequest(request: Request, user: App.Locals['user']): boolean {
	if (user) return true;
	const cronSecret = process.env.CRON_SECRET;
	return !!cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`;
}
