import { redirect, error, type Handle } from '@sveltejs/kit';
import { COOKIE, resolve as resolveSession } from '$lib/server/auth';

/** Reachable without signing in. Everything else is not. */
const OPEN = new Set(['/login']);

/**
 * One place decides whether a request is allowed. Per-route checks are how a
 * route ends up with none: this one is wrong by omission only if a route is
 * added to OPEN on purpose.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(COOKIE);
	event.locals.user = await resolveSession(token);

	const path = event.url.pathname;
	if (!event.locals.user && !OPEN.has(path)) {
		// The capture queue keeps 5xx and drops 4xx, and 401 is neither: the
		// entry is fine, the session is not. It answers 401 so the queue can
		// tell the difference, and queue.ts keeps it.
		if (path.startsWith('/api/')) error(401, 'sign in first');
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}

	const response = await resolve(event);

	/**
	 * The headers that cost nothing and are only ever missing by omission.
	 *
	 * The CSP itself is declared in vite.config.ts, because SvelteKit has to
	 * hash its own inline bootstrap and only it knows what that is. These are
	 * the rest, and they are set here rather than left to a reverse proxy: this
	 * app is handed to a host as a standalone server, and a header that depends
	 * on somebody else's nginx is a header that is absent the first time it is
	 * run anywhere new.
	 */
	response.headers.set('X-Content-Type-Options', 'nosniff');
	// same-origin, not no-referrer: an internal link keeps its referrer, and
	// nothing leaves this origin anyway.
	response.headers.set('Referrer-Policy', 'same-origin');
	// Nothing here asks for a camera, a microphone or a location. Saying so
	// stops an injected script asking on the app's behalf.
	response.headers.set(
		'Permissions-Policy',
		'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()'
	);
	// frame-ancestors 'none' in the CSP says this to anything modern.
	response.headers.set('X-Frame-Options', 'DENY');

	// Only over TLS, and only in production: sent over plain http it is
	// ignored, and set in development it would pin localhost to https in the
	// browser for two years.
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	}

	return response;
};
