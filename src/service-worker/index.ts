import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { OFFLINE_COPY, SESSION_UNUSED_DAYS } from '#lib/offline-copy.ts';

/**
 * What reckon does without a signal.
 *
 * Time is recorded where reception is bad, and the capture queue already holds
 * an entry until it can be posted (#lib/queue.ts). What it could not do is let
 * the app be opened with no signal at all. This makes Today and the Time screens
 * open from their last copy, so a timer can be started or stopped and time
 * entered by hand, offline, from a cold start; the queue posts it later.
 *
 * The invoices list, and each draft with its Add a line and its lines' own
 * screens, are kept the same way, so a line can be added, changed or taken off
 * on site; the queue sends that too. So are New
 * draft and the screens for a draft started on the phone, which takes its
 * number when it arrives. Which drafts there are is the server's to say
 * (/api/offline), and a draft that has gone out stops being kept. Each says how old its copy is when it is opened
 * from it (#lib/OfflineBanner).
 *
 * The person's own time entries of this week and last that are not yet billed
 * or paid, each on its screen, and All entries holding only those, so an entry
 * is changed or removed on site.
 *
 * Trips too: the list, New trip, and each trip the person drove whose miles are
 * not yet billed, with its Change, so a trip is recorded or put right on the
 * road.
 *
 * And, for someone with Full, the stock: Materials, each material with its
 * Stock tab, Receive, and the count being counted or one started on the
 * phone, with quantities alone, so stock is received, adjusted and counted in
 * a shop or a van with no signal; the queue sends it. The queue sends it when there is a signal, and Google's route takes
 * the place of miles the phone could only estimate.
 *
 * EVERY SCREEN IS KEPT AS A COPY OF ITS OWN, cut to what can be done with it
 * there (#lib/offline-copy): fetched with that query and kept in the screen's
 * place. The screen as it is with a signal -- what the business is owed, what
 * work is worth, anyone's pay, everyone's day -- is never kept.
 *
 * Nothing else is kept. A sent invoice, a report or a setting shown from a
 * stale copy would be a figure presented as current that is not, so those
 * screens say they need a connection instead.
 *
 * Two caches, both named for the deploy, so a new deploy starts clean and never
 * mixes its pages with the last one's code:
 *
 *   shell   the app's own files -- the built code, the fonts, the icons, and
 *           the page that says a screen needs a connection. Never personal.
 *   pages   the offline copies, as the person signed in last had them.
 *           Personal, so it is emptied when they sign out, when a request finds
 *           the session gone, and when the server has not been reached for as
 *           long as a session lasts unused (SESSION_UNUSED_DAYS): by then the
 *           server has ended it, and the phone cannot hear that, so it forgets
 *           by itself (ASVS 5.0 14.3.1).
 *
 * Unsent work is not a copy: the queue keeps it until it is sent (#lib/queue).
 */

const SHELL = `shell-${version}`;
const PAGES = `pages-${version}`;

// Absolute pathnames, to match against a request's: resolved against the
// worker's own scope, which is wherever the app is served from.
const at = (path: string) => new URL(path, self.registration.scope).pathname;
const FILES = [...immutable, ...assets].map((file) => at(file.path));
const OFFLINE_PAGE = at('offline.html');

/** The screens that always work without a signal, by pathname. */
const OFFLINE_SCREENS = ['/', '/timesheet', '/timesheet/start', '/timesheet/manual'];
/** Where the server says which drafts to keep besides, and where its answer is kept. */
const LIST = '/api/offline';
/**
 * When the server last confirmed the session -- its list came back to someone
 * signed in -- by this phone's clock, kept beside the copies.
 */
const CONFIRMED = at('__confirmed');
const LAPSE_MS = SESSION_UNUSED_DAYS * 86_400_000;
/** And the request each screen makes for its data on a client-side navigation. */
const dataOf = (screen: string) => `${screen === '/' ? '' : screen}/__data.json`;
const OFFLINE_DATA = OFFLINE_SCREENS.map(dataOf);
/**
 * The data of the screens the list may name: the invoices list, New draft, a
 * draft started on the phone and its Add a line, and a draft, its Add a line,
 * and each line added by hand with its Change; All entries and a time entry;
 * the trips list, New trip, and a trip with its Change; Materials, a material,
 * Receive, and a count.
 */
const LISTED_DATA =
	/^\/(invoices(\/new|\/on-phone(\/add)?|\/[0-9a-f-]{36}(\/add|\/lines\/[0-9a-f-]{36}(\/change)?)?)?|timesheet\/(all|[0-9a-f-]{36})|trips(\/new|\/[0-9a-f-]{36}(\/change)?)?|catalogue\/(materials(\/[0-9a-f-]{36})?|receipts\/new|counts\/(on-phone|[0-9a-f-]{36})))\/__data\.json$/;

/** The screens kept now, as listed: the ones always kept, and the ones the server last listed. */
let listed: string[] | null = null;
async function screens(): Promise<string[]> {
	if (listed === null) {
		const kept = await caches.match(LIST, { cacheName: PAGES });
		listed = kept ? ((await kept.json()) as { screens: string[] }).screens : [];
	}
	return [...OFFLINE_SCREENS, ...listed];
}
/** What the offline screens draw with besides the shell: the operator's colour and mark. */
const OPERATOR = ['/operator/theme.css', '/operator/logo'];

const signedOut = (response: Response) =>
	response.redirected && new URL(response.url).pathname === '/login';

async function forget() {
	listed = null;
	await caches.delete(PAGES);
}

/**
 * Whether the copies have outlived the session: kept, and the server not
 * reached for as long as one lasts unused. If so they are forgotten now.
 */
async function lapsed(): Promise<boolean> {
	const kept = await caches.match(CONFIRMED, { cacheName: PAGES });
	if (!kept) return false;
	if (Date.now() - Number(await kept.text()) <= LAPSE_MS) return false;
	await forget();
	return true;
}

/**
 * The app's own files, any the browser has let go put back: what a screen
 * kept for no signal is drawn with.
 */
async function refill() {
	const shell = await caches.open(SHELL);
	const have = new Set((await shell.keys()).map((r) => new URL(r.url).pathname));
	const missing = FILES.filter((f) => !have.has(f));
	if (missing.length) await shell.addAll(missing);
}

/**
 * Fetches the offline screens and their data now, while there is a signal --
 * so one never opened is still there without one. Stops, and forgets, at the
 * first sign the session is gone. A draft no longer listed -- sent, or deleted
 * -- is let go.
 */
async function warm() {
	await refill().catch(() => {});
	const pages = await caches.open(PAGES);
	const list = await fetch(LIST);
	if (signedOut(list)) return forget();
	if (list.ok) {
		const body = (await list.clone().json()) as { screens?: unknown };
		if (Array.isArray(body.screens)) {
			await pages.put(LIST, list);
			await pages.put(CONFIRMED, new Response(String(Date.now())));
			listed = body.screens.filter((x): x is string => typeof x === 'string');
		}
	}
	const all = await screens();
	const keep = new Set([...all, ...all.map(dataOf), LIST, CONFIRMED]);
	for (const request of await pages.keys()) {
		const path = new URL(request.url).pathname;
		if (!keep.has(path) && !OPERATOR.includes(path)) await pages.delete(request);
	}
	for (const screen of all) {
		const page = await fetch(`${screen}?${OFFLINE_COPY}`);
		if (signedOut(page)) return forget();
		if (!page.ok) continue;
		await pages.put(screen, page);
		const data = await fetch(`${dataOf(screen)}?${OFFLINE_COPY}`);
		// Signed out, a data request still answers 200, with a redirect inside it.
		const body = data.ok ? await data.clone().text() : '';
		if (body.startsWith('{"type":"data"')) await pages.put(dataOf(screen), data);
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((shell) => shell.addAll(FILES))
			// A new deploy's worker takes over at once: its pages and files are in
			// its own caches, and an old page that asks for a file it no longer has
			// gets the network, or SvelteKit's reload.
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys())
				if (key !== SHELL && key !== PAGES) await caches.delete(key);
			await self.clients.claim();
		})()
	);
});

self.addEventListener('message', (event) => {
	if ((event.data as { type?: string } | null)?.type === 'warm')
		event.waitUntil(warm().catch(() => {}));
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// Signing out empties the personal cache, whatever the response. The
	// request goes on to the network untouched: the browser honours what its
	// answer says to clear only on a response it fetched itself, not on one a
	// worker hands it (Clear Site Data, 5.2).
	if (request.method === 'POST' && url.pathname === '/logout') {
		event.waitUntil(forget());
		return;
	}
	if (request.method !== 'GET') return;

	// The app's own files never change under a name: from the cache.
	if (FILES.includes(url.pathname)) {
		event.respondWith(
			caches.match(url.pathname, { cacheName: SHELL }).then((hit) => hit ?? fetch(request))
		);
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(navigate(request, url));
		return;
	}

	if (
		OFFLINE_DATA.includes(url.pathname) ||
		LISTED_DATA.test(url.pathname) ||
		OPERATOR.includes(url.pathname)
	) {
		event.respondWith(networkFirst(request, url));
	}
	// Everything else -- the API, other screens' data -- goes to the network
	// untouched. Offline, a screen's data request fails and SvelteKit falls back
	// to a full navigation, which lands on the page below.
});

/**
 * A screen. From the network; without one, its copy or the offline page. A
 * copy is kept only as warm() fetches it, never the screen as it came now.
 */
async function navigate(request: Request, url: URL): Promise<Response> {
	try {
		const response = await fetch(request);
		if (signedOut(response)) await forget();
		return response;
	} catch {
		const offlineScreen = (await screens()).includes(url.pathname) && !(await lapsed());
		const kept = offlineScreen ? await caches.match(url.pathname, { cacheName: PAGES }) : undefined;
		return kept ?? (await caches.match(OFFLINE_PAGE, { cacheName: SHELL })) ?? Response.error();
	}
}

/** Data an offline screen draws from. From the network; without one, its copy. */
async function networkFirst(request: Request, url: URL): Promise<Response> {
	try {
		const response = await fetch(request);
		// The operator's colour and mark are kept whenever they arrive; a screen's
		// data only by warm(), whole, never a partial reload of one of its parts.
		// Never a redirect followed to somewhere else: that is not this file, and
		// kept under its name it would stand in for it offline.
		if (response.ok && !response.redirected && OPERATOR.includes(url.pathname))
			await (await caches.open(PAGES)).put(request, response.clone());
		return response;
	} catch (error) {
		if (await lapsed()) throw error;
		const kept = await caches.match(OPERATOR.includes(url.pathname) ? request : url.pathname, {
			cacheName: PAGES,
			ignoreSearch: !OPERATOR.includes(url.pathname)
		});
		if (kept) return kept;
		throw error;
	}
}
