// Temporal, before anything that uses it: the server's Node does not have it
// until Node 26, and the polyfill steps aside for a runtime that does
// (hooks.client.ts does the same in the browser). Nothing that
// scripts/refresh-tax-rates.mjs imports may need it -- that runs under plain
// Node, without this file.
import 'temporal-polyfill/global';
import { redirect, error } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { eq } from 'drizzle-orm';
import { SECURE_COOKIES } from '$app/env/private';
import { authHeaders, getAuth } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { getRequestEvent } from '$app/server';
import { businessDefaults } from '#lib/server/business.ts';
import { readLocaleFrom } from '#lib/format.ts';
import { readCurrencyFrom } from '#lib/currency.ts';
import { localeTag, weekStartOf, type HourCycle } from '#lib/locales.ts';

/**
 * Made when the server starts rather than at its first request, so a
 * configuration Better Auth refuses stops the process with its reason instead
 * of answering every request with a 500.
 */
export const init: ServerInit = () => {
	getAuth();
	// Every figure and date is written in the locale of the person the request
	// is for (#lib/format). Read from the request in hand, never kept in a
	// module, because the server is rendering for several people at once.
	readLocaleFrom(() => {
		try {
			return getRequestEvent().locals.locale ?? 'en-US';
		} catch {
			return 'en-US';
		}
	});
	// And every amount in the business's currency, to its places (#lib/currency).
	readCurrencyFrom(() => {
		try {
			return getRequestEvent().locals.currency ?? 'USD';
		} catch {
			return 'USD';
		}
	});
	// Chosen, and allowed, but never quietly: whoever reads the log should see
	// that the session token is travelling in the clear.
	if (!SECURE_COOKIES)
		console.warn(
			'SECURE_COOKIES=false: the session cookie is not Secure, so a browser sends it over plain http too.'
		);
};

/**
 * Reachable without signing in. Everything else is not.
 *
 * The manifest, the logo and the operator's stylesheet are here because the
 * sign-in page uses them, and a browser fetches the first two without the
 * session cookie anyway -- to install the app, and to draw its icon. None of
 * them says more than the sign-in page already does: the business's name,
 * colour and mark.
 */
const OPEN = new Set(['/login', '/manifest.webmanifest', '/operator/logo', '/operator/theme.css']);

/**
 * One place decides whether a request is allowed. Per-route checks are how a
 * route ends up with none: this one is wrong by omission only if a route is
 * added to OPEN on purpose.
 */
export const handle: Handle = async ({ event, resolve }) => {
	// A person made inactive is signed out wherever they are, at their next
	// request, rather than keeping a session until it expires.
	const found = await getAuth().api.getSession({ headers: authHeaders(event) });
	event.locals.user =
		found && found.user.active !== false
			? {
					id: found.user.id,
					name: found.user.name,
					email: found.user.email,
					timezone: found.user.timezone ?? null,
					locale: found.user.locale ?? null,
					hourCycle: (found.user.hourCycle as HourCycle | null | undefined) ?? null,
					weekStart: found.user.weekStart ?? null
				}
			: null;
	if (found && found.user.active === false)
		await db.delete(schema.session).where(eq(schema.session.userId, found.user.id));

	// Whose clocks this request runs on (#lib/server/calendar) -- the
	// business's, and the person's own, which follows the business's until they
	// set it -- how their figures read (#lib/format): their own locale, clock
	// and week, or the business's where they have not chosen -- and what the
	// business counts its money in.
	const business = await businessDefaults();
	const me = event.locals.user;
	event.locals.businessZone = business.zone;
	event.locals.zone = me?.timezone ?? business.zone;
	event.locals.businessLocale = business.locale;
	const locale = me?.locale ?? business.locale;
	event.locals.locale = localeTag(locale, me?.hourCycle ?? null);
	event.locals.weekStart = me?.weekStart ?? weekStartOf(locale);
	event.locals.currency = business.currency;

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

	// SvelteKit puts the CSP on the pages it renders and on nothing else. The
	// rest -- the logo, the operator's stylesheet, the manifest, the API -- is
	// never meant to be opened as a page, and an SVG logo opened as one would
	// run its script as reckon, with the viewer's session. So whatever arrives
	// here without a policy gets one that runs nothing: no script, nothing
	// fetched, only the inline style and data images an SVG draws with, and a
	// sandbox that takes it out of this origin altogether. An <img> or a
	// <link> using the same response is not affected; this applies only when
	// it is opened as a document.
	if (!response.headers.has('Content-Security-Policy'))
		response.headers.set(
			'Content-Security-Policy',
			"default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
		);

	// Only over TLS, and only in production: sent over plain http it is
	// ignored, and set in development it would pin localhost to https in the
	// browser for two years.
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	}

	return response;
};
