// Temporal, before anything that uses it: the server's Node does not have it
// until Node 26, and the polyfill steps aside for a runtime that does
// (hooks.client.ts does the same in the browser). Nothing that
// scripts/refresh-tax-rates.mjs imports may need it -- that runs under plain
// Node, without this file.
import 'temporal-polyfill/global';
import { redirect, error } from '@sveltejs/kit';
import {
	sequence,
	type Handle,
	type HandleServerError,
	type ServerInit
} from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { MIGRATE_ON_START, SECURE_COOKIES, SITE_URL } from '$app/env/private';
import { authHeaders, getAuth } from '#lib/server/auth.ts';
import { googleKey } from '#lib/server/google-key.ts';
import { startSending } from '#lib/server/email.ts';
import { pool } from '#lib/server/db/index.ts';
import { bringUpToDate, mustBeUpToDate } from '#lib/server/db/migrate.ts';
import { building } from '$app/env';
import { getRequestEvent } from '$app/server';
import { businessDefaults } from '#lib/server/business.ts';
import { readLocaleFrom } from '#lib/format.ts';
import { readCurrencyFrom } from '#lib/currency.ts';
import { localeTag, weekStartOf, type HourCycle } from '#lib/locales.ts';
import { REACH, reaches } from '#lib/access.ts';
import { LINK_PAGE } from '#lib/client-link.ts';
import { problem } from '#lib/server/problem.ts';
import { THEME_COOKIE, themeFrom } from '#lib/device-fields.ts';
import { log, requestFields } from '#lib/server/log.ts';
import { readOriginFrom, recordAside, startPruning } from '#lib/server/events.ts';
import { refusedForAccess } from '#lib/server/refused.ts';

/**
 * Made when the server starts rather than at its first request, so a
 * configuration Better Auth refuses stops the process with its reason instead
 * of answering every request with a 500.
 *
 * And the database is checked first (#lib/server/db/migrate): a migration in
 * the drizzle/ beside the build it has not seen stops the server starting,
 * before the first request is answered, so nothing is ever served from a
 * database the code does not expect. Migrating is its own step, run as the
 * database's owner; where MIGRATE_ON_START=true the server, connected as the
 * owner, brings it up to date itself, and one that fails stops the start the
 * same way. Not while building, when there is no database to reach.
 */
export const init: ServerInit = async () => {
	try {
		await startUp();
	} catch (e) {
		// One line saying why, before the start fails and its stack follows.
		log.fatal(
			{ event: 'sys_crash', err: e },
			`reckon did not start: ${e instanceof Error ? e.message : String(e)}`
		);
		throw e;
	}
	if (building) return;
	log.info({ event: 'sys_startup' }, 'reckon started');
	watchTheProcess();
	// And a year's security log is all that is kept (#lib/server/events).
	startPruning();
};

async function startUp() {
	if (!building) await (MIGRATE_ON_START ? bringUpToDate(pool) : mustBeUpToDate(pool));
	getAuth();
	// A key given both as itself and as a file stops the start here, as the
	// session secret's does in getAuth, rather than the first address entered.
	googleKey();
	// And the email relay's settings, likewise; then whatever is waiting to be
	// sent goes, and the server keeps sending as more is written
	// (#lib/server/email).
	if (!building) startSending();
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
	// Each security event says where its request came from and who was signed
	// in to make it, from the request in hand (#lib/server/events).
	readOriginFrom(() => {
		try {
			const event = getRequestEvent();
			const fields = requestFields(event);
			return {
				address: fields['client.address'],
				userAgent: fields['user_agent.original'],
				by: event.locals.user?.id ?? null
			};
		} catch {
			return {};
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
	// Allowed, since building and a first start have none, but never quietly:
	// without it nobody can sign in at all.
	if (!building && !SITE_URL)
		log.warn(
			'SITE_URL is unset: a passkey is made for that site, so nobody can make one or sign in with one. Set it to where reckon is reached.'
		);
	// Chosen, and allowed, but never quietly: whoever reads the log should see
	// that the session token is travelling in the clear.
	if (!SECURE_COOKIES)
		log.warn(
			'SECURE_COOKIES=false: the session cookie is not Secure, so a browser sends it over plain http too.'
		);
}

/** Set once the process is watched, so a reloaded module in development watches it once. */
const WATCHED = Symbol.for('reckon.watched');

/**
 * Stopping, and an exception nothing caught, each recorded as one line: the
 * second as Node is about to end the process, which it still does
 * (uncaughtExceptionMonitor changes nothing of that).
 */
function watchTheProcess() {
	const all = globalThis as { [WATCHED]?: true };
	if (all[WATCHED]) return;
	all[WATCHED] = true;
	process.once('sveltekit:shutdown', (reason: string) =>
		log.info({ event: 'sys_shutdown', reason }, `reckon stopping (${reason})`)
	);
	process.on('uncaughtExceptionMonitor', (e, origin) =>
		log.fatal({ event: 'sys_crash', err: e, origin }, `reckon stopped: ${e.message}`)
	);
}

/**
 * AN ERROR NOBODY MEANT is recorded with an id, and whoever met it is shown
 * that id and nothing more: never a stack, a query or a value (ASVS 5.0
 * 16.3.4, 16.5.1). An error reckon throws on purpose -- a 404, a refusal --
 * keeps its own status and message, and is not an error to record.
 */
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') return;
	const id = crypto.randomUUID();
	log.error(
		{
			err: error,
			'error.id': id,
			'error.type': error instanceof Error ? error.constructor.name : typeof error,
			...requestFields(event)
		},
		'An error nobody meant'
	);
	return {
		message: `Something went wrong on reckon's side. If it happens again, give this to whoever runs reckon: ${id}`,
		id
	};
};

/**
 * Better Auth's own routes, under /api/auth, mounted as its SvelteKit guide
 * mounts them -- and only where SITE_URL is set, since that is the only base
 * URL it is given (#lib/server/auth). Which are served is
 * #lib/server/auth-paths; each it serves answers before reckon's own routes
 * are looked at, and with the same headers they get.
 *
 * The address it counts and records is the one adapter-node resolved, set as
 * x-forwarded-for over whatever the client sent, as its ipAddressHeaders
 * option asks ("list only ones your proxy or server code sets, replacing any
 * client value").
 */
const betterAuthRoutes: Handle = async ({ event, resolve }) => {
	if (!SITE_URL) return resolve(event);
	const auth = getAuth();
	let theirs = false;
	const response = await svelteKitHandler({
		event,
		resolve,
		building,
		auth: {
			options: auth.options,
			handler: (request) => {
				theirs = true;
				return auth.handler(new Request(request, { headers: authHeaders(event) }));
			}
		}
	});
	// Better Auth's own limiter turning a request away (ASVS 5.0 16.3.3).
	if (theirs && response.status === 429)
		await recordAside('excess_rate_limit_exceeded', {
			user: null,
			by: null,
			detail: { tried: event.url.pathname.replace(/^\/api\/auth/, '') }
		});
	return theirs ? secured(event.url, response) : response;
};

/**
 * One place decides whether a request is allowed: #lib/access says who reaches
 * each route, and a route missing from it does not typecheck. Per-route checks
 * are how a route ends up with none.
 *
 * Open without signing in: the sign-in page and what it uses -- the manifest,
 * the logo and the operator's stylesheet, which a browser fetches without the
 * session cookie anyway, to install the app and draw its icon, and none of
 * which says more than the sign-in page already does -- the client's link to a
 * sent invoice (#lib/client-link), and where a link reckon emailed opens
 * (#lib/server/links).
 */
const app: Handle = async ({ event, resolve }) => {
	// Someone made inactive is signed out everywhere as it is done
	// (api/people/[id]), and refused a session after (#lib/server/passkeys
	// mayOpenSession); a session that is theirs all the same reaches nothing.
	const found = await getAuth().api.getSession({ headers: authHeaders(event) });
	event.locals.user =
		found && found.user.active !== false
			? {
					id: found.user.id,
					name: found.user.name,
					email: found.user.email,
					// Anything but Full is Field: a level the app does not know reaches
					// the least.
					access: found.user.access === 'full' ? 'full' : 'field',
					timezone: found.user.timezone ?? null,
					locale: found.user.locale ?? null,
					hourCycle: (found.user.hourCycle as HourCycle | null | undefined) ?? null,
					weekStart: found.user.weekStart ?? null
				}
			: null;
	event.locals.sessionId = event.locals.user ? found!.session.id : null;

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
	// Light or dark is the device's, in a cookie on it (#lib/device-fields),
	// signed in or not: the sign-in page is drawn in it too.
	event.locals.theme = themeFrom(event.cookies.get(THEME_COOKIE));

	// A path that is no route needs signing in, and is then not found.
	const path = event.url.pathname;
	const need = event.route.id ? REACH[event.route.id] : 'field';
	if (!event.locals.user && need !== 'open') {
		// The capture queue keeps 5xx and drops 4xx, and 401 is neither: the
		// entry is fine, the session is not. It answers 401 so the queue can
		// tell the difference, and queue.ts keeps it.
		if (path.startsWith('/api/')) error(401, 'sign in first');
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	// Refused before the route runs, so nothing of it is read or written. An
	// endpoint says so as every refusal does, for the queue to keep and show; a
	// screen is turned away to the one that says why, inside the app, as the
	// sign-in page is reached -- an error thrown here would be drawn outside it.
	if (event.locals.user && !reaches(event.locals.user.access, need)) {
		await refusedForAccess(event);
		if (path.startsWith('/api/'))
			return secured(event.url, problem('beyondAccess', 403, 'That needs Full access.'));
		redirect(303, '/refused');
	}

	// The theme goes on <html> before the page leaves, so the first paint is in
	// it. Empty, it matches neither theme's rule and the device's own decides.
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%theme%', event.locals.theme ?? '')
	});
	// And one a route refused itself: everything reckon answers 403 is that.
	if (event.locals.user && response.status === 403) await refusedForAccess(event);

	return secured(event.url, response);
};

export const handle = sequence(betterAuthRoutes, app);

/**
 * The headers that cost nothing and are only ever missing by omission, on
 * whatever is answered -- a refusal made in handle as much as what a route
 * answers.
 *
 * The CSP itself is declared in vite.config.ts, because SvelteKit has to
 * hash its own inline bootstrap and only it knows what that is. These are
 * the rest, and they are set here rather than left to a reverse proxy: this
 * app is handed to a host as a standalone server, and a header that depends
 * on somebody else's nginx is a header that is absent the first time it is
 * run anywhere new.
 */
function secured(url: URL, response: Response): Response {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	// same-origin, not no-referrer: an internal link keeps its referrer, and
	// nothing leaves this origin anyway. Where an emailed link opens, none at
	// all, as OWASP's Forgot Password Cheat Sheet has it: its code is never in
	// the address, but nothing there needs a referrer either.
	response.headers.set(
		'Referrer-Policy',
		LINK_PAGE.test(url.pathname) ? 'no-referrer' : 'same-origin'
	);
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
	if (url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	}

	return response;
}
