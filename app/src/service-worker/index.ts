import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';

/**
 * What reckon does without a signal.
 *
 * Time is recorded where reception is bad, and the capture queue already holds
 * an entry until it can be posted (#lib/queue.ts). What it could not do is let
 * the app be opened with no signal at all. This makes Today and the Time screens
 * open from their last copy, so a timer can be started or stopped and time
 * entered by hand, offline, from a cold start; the queue posts it later.
 *
 * Nothing else is kept. An invoice, a report or a setting shown from a stale
 * copy would be a figure presented as current that is not, so those screens say
 * they need a connection instead.
 *
 * Two caches, both named for the deploy, so a new deploy starts clean and never
 * mixes its pages with the last one's code:
 *
 *   shell   the app's own files -- the built code, the fonts, the icons, and
 *           the page that says a screen needs a connection. Never personal.
 *   pages   the offline screens and their data, as the person signed in last
 *           saw them. Personal, so it is emptied when they sign out, and when
 *           a request finds the session gone.
 */

const SHELL = `shell-${version}`;
const PAGES = `pages-${version}`;

// Absolute pathnames, to match against a request's: resolved against the
// worker's own scope, which is wherever the app is served from.
const at = (path: string) => new URL(path, self.registration.scope).pathname;
const FILES = [...immutable, ...assets].map((file) => at(file.path));
const OFFLINE_PAGE = at('offline.html');

/** The screens that work without a signal, by pathname. */
const OFFLINE_SCREENS = ['/', '/timesheet', '/timesheet/start', '/timesheet/manual'];
/** And the request each makes for its data on a client-side navigation. */
const dataOf = (screen: string) => `${screen === '/' ? '' : screen}/__data.json`;
const OFFLINE_DATA = OFFLINE_SCREENS.map(dataOf);
/** What the offline screens draw with besides the shell: the operator's colour and mark. */
const OPERATOR = ['/operator/theme.css', '/operator/logo'];

const signedOut = (response: Response) =>
	response.redirected && new URL(response.url).pathname === '/login';

async function forget() {
	await caches.delete(PAGES);
}

/**
 * Fetches the offline screens and their data now, while there is a signal --
 * so one never opened is still there without one. Stops, and forgets, at the
 * first sign the session is gone.
 */
async function warm() {
	const pages = await caches.open(PAGES);
	for (const screen of OFFLINE_SCREENS) {
		const page = await fetch(screen);
		if (signedOut(page)) return forget();
		if (!page.ok) continue;
		await pages.put(screen, page);
		const data = await fetch(dataOf(screen));
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

	// Signing out empties the personal cache, whatever the response.
	if (request.method === 'POST' && url.pathname === '/logout') {
		event.respondWith(fetch(request).finally(forget));
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

	if (OFFLINE_DATA.includes(url.pathname) || OPERATOR.includes(url.pathname)) {
		event.respondWith(networkFirst(request, url));
	}
	// Everything else -- the API, other screens' data -- goes to the network
	// untouched. Offline, a screen's data request fails and SvelteKit falls back
	// to a full navigation, which lands on the page below.
});

/** A screen. From the network; without one, its last copy or the offline page. */
async function navigate(request: Request, url: URL): Promise<Response> {
	const offlineScreen = OFFLINE_SCREENS.includes(url.pathname);
	try {
		const response = await fetch(request);
		if (signedOut(response)) await forget();
		else if (offlineScreen && response.ok)
			await (await caches.open(PAGES)).put(url.pathname, response.clone());
		return response;
	} catch {
		const kept = offlineScreen ? await caches.match(url.pathname, { cacheName: PAGES }) : undefined;
		return kept ?? (await caches.match(OFFLINE_PAGE, { cacheName: SHELL })) ?? Response.error();
	}
}

/** Data an offline screen draws from. From the network; without one, the last full copy. */
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
		const kept = await caches.match(OPERATOR.includes(url.pathname) ? request : url.pathname, {
			cacheName: PAGES,
			ignoreSearch: !OPERATOR.includes(url.pathname)
		});
		if (kept) return kept;
		throw error;
	}
}
