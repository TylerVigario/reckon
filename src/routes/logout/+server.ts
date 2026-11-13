import { authHeaders, getAuth } from '#lib/server/auth.ts';
import { recordAside } from '#lib/server/events.ts';
import type { RequestHandler } from './$types';

/**
 * Signing out: the session ended on the server, its cookie expired, and what
 * this browser's cache holds of reckon cleared with it (ASVS 5.0 14.3.1). The
 * service worker empties its own copies as the request passes it.
 *
 * "cache" alone, of what Clear-Site-Data can clear. Not "cookies", which
 * clears "cookies on any origin in the same registered domain" (Clear Site
 * Data, 3.1): run beside other apps under one domain, signing out of reckon
 * would sign the person out of every one of them, and reckon's own cookie is
 * expired by the sign-out regardless. Not "storage", which deletes every
 * IndexedDB database (4.2.5): the work on the phone not yet sent, which stays
 * until it is (#lib/queue).
 */
export const POST: RequestHandler = async (event) => {
	const me = event.locals.user;
	await getAuth()
		.api.signOut({ headers: authHeaders(event) })
		.catch(() => {});
	if (me) await recordAside('session_logout', { user: me.id, by: null });
	// Its cookie expired through event.cookies (sveltekitCookies), which
	// SvelteKit adds to whatever is returned.
	return new Response(null, {
		status: 303,
		headers: { location: '/login', 'clear-site-data': '"cache"' }
	});
};
