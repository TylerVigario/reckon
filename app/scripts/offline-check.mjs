#!/usr/bin/env node
/**
 * Proves the installed app works without a signal.
 *
 *   node scripts/offline-check.mjs <base-url> <email> <password> online
 *   (stop the server)
 *   node scripts/offline-check.mjs <base-url> <email> <password> offline
 *   (start it again)
 *   node scripts/offline-check.mjs <base-url> <email> <password> back
 *
 * WHY THREE RUNS. Offline is the server being out of reach, so the server is
 * actually stopped between them, rather than the page being told it is offline:
 * the service worker fetches on its own, and a flag set on the page does not
 * reach it. The browser stays up throughout -- the same one on 9222 that
 * console-check uses -- so the worker, its caches and the capture queue carry
 * from one run to the next, as they do on a phone.
 *
 *   online   signs in, waits for the worker to keep the offline screens, and
 *            asks Chrome whether the app is installable.
 *   offline  opens each offline screen from a cold load; confirms a screen that
 *            needs the network says so instead; starts a timer and stops it,
 *            which leaves an entry in the queue. Beside it goes a copy naming a
 *            service that does not exist -- what an entry recorded offline
 *            looks like once someone deletes its service meanwhile.
 *   back     opens a page, which posts the queue. The good entry goes; the other
 *            is refused, and must be kept, shown with the server's reason,
 *            open to be fixed, and gone only when discarded by hand. Then signs
 *            out, which must empty the cache the worker kept.
 */
const [, , base = 'http://127.0.0.1:5181', email, password, phase] = process.argv;
if (!['online', 'offline', 'back'].includes(phase ?? '')) {
	console.error(
		'usage: node scripts/offline-check.mjs <base-url> <email> <password> online|offline|back'
	);
	process.exit(2);
}

const targets = /** @type {{ type: string; webSocketDebuggerUrl: string }[]} */ (
	await (await fetch('http://127.0.0.1:9222/json')).json()
);
const target = targets.find((t) => t.type === 'page');
if (!target) {
	console.error('No browser on 9222. Start headless_shell with --remote-debugging-port=9222.');
	process.exit(2);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
/**
 * Whatever the page throws and nothing catches. Without a connection is where
 * a promise nobody handles is likeliest to reject -- every fetch fails -- and
 * the screen can look right while one does.
 * @type {string[]}
 */
const uncaught = [];
ws.onmessage = (/** @type {{ data: string }} */ m) => {
	const x = JSON.parse(m.data);
	if (x.id && waiting.has(x.id)) waiting.get(x.id)(x);
	if (x.method === 'Runtime.exceptionThrown') {
		const d = x.params.exceptionDetails;
		uncaught.push((d.exception?.description ?? d.text).split('\n')[0]);
	}
};
/** @returns {Promise<any>} */
const send = (/** @type {string} */ method, /** @type {Record<string, unknown>} */ params = {}) =>
	new Promise((res) => {
		const n = ++id;
		waiting.set(n, res);
		ws.send(JSON.stringify({ id: n, method, params }));
	});
const evaluate = async (/** @type {string} */ expression) =>
	(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
		?.result?.value;
const settle = (ms = 1800) => new Promise((r) => setTimeout(r, ms));

/**
 * Text that may have come from the page, made fit for one line of this log.
 * Every control character -- a line break, a terminal escape -- goes, a line
 * break leaving a space, so nothing a page says can start a line here or pass
 * for one of GitHub's workflow commands.
 */
const line = (/** @type {string} */ s) =>
	s.replace(/(?:(?!\n)\p{Cc})+|(?=\n)/gu, ' ').replace(/\n/g, '');
const go = async (/** @type {string} */ path) => {
	await send('Page.navigate', { url: base + path });
	await settle(2000);
};
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
// Over plain http the browser says what a TLS proxy would (see console-check).
if (base.startsWith('http:'))
	await send('Network.setExtraHTTPHeaders', { headers: { 'x-forwarded-proto': 'http' } });
await send('Emulation.setDeviceMetricsOverride', {
	width: 412,
	height: 915,
	deviceScaleFactor: 2,
	mobile: true
});

/** @type {string[]} */
const failures = [];
const ok = (/** @type {string} */ what) => console.log(`  ✓ ${line(what)}`);
const check = (/** @type {boolean} */ pass, /** @type {string} */ what) =>
	pass ? ok(what) : failures.push(what);

const heading = () => evaluate(`document.querySelector('h1')?.textContent?.trim() ?? ''`);
const kept = () =>
	evaluate(`(async () => {
		const name = (await caches.keys()).find((k) => k.startsWith('pages-'));
		return name ? (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname) : [];
	})()`);
const stored = (/** @type {string} */ key) =>
	evaluate(
		`(() => { try { return JSON.parse(localStorage.getItem('${key}') ?? '[]').length } catch { return -1 } })()`
	);
/**
 * Runs `body` against the capture queue's store, in the page, and returns what
 * it resolves. The same database and schema the app opens (#lib/queue.ts).
 */
const inQueue = (/** @type {string} */ body) =>
	evaluate(`new Promise((resolve) => {
		const req = indexedDB.open('reckon', 1);
		req.onupgradeneeded = () =>
			req.result.createObjectStore('queue', { keyPath: 'entry.client_uuid' });
		req.onerror = () => resolve(null);
		req.onsuccess = () => {
			const db = req.result;
			const done = (v) => { db.close(); resolve(v); };
			${body}
		};
	})`);
/** @returns {Promise<{ id: string, refused: string | null }[] | null>} */
const queued = () =>
	inQueue(`const all = db.transaction('queue').objectStore('queue').getAll();
		all.onsuccess = () =>
			done(all.result.map((q) => ({ id: q.entry.client_uuid, refused: q.refused?.detail ?? null })));
		all.onerror = () => done(null);`);
const click = (/** @type {string} */ text) =>
	evaluate(`(() => {
		const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
		if (!b) return false;
		b.click();
		return true;
	})()`);

const OFFLINE = ['/', '/timesheet', '/timesheet/start', '/timesheet/manual'];

if (phase === 'online') {
	await go('/login');
	await evaluate(`(() => {
		document.querySelector('input[name=email]').value = ${JSON.stringify(email)};
		document.querySelector('input[name=password]').value = ${JSON.stringify(password)};
		document.querySelector('form').requestSubmit();
	})()`);
	await settle(2400);
	await go('/');

	// The worker installs on the first load, then fetches the offline screens
	// when the page asks it to; a fresh load makes sure it is the one asked.
	/** @type {string[]} */
	let have = [];
	for (let i = 0; i < 20 && have.length < OFFLINE.length * 2; i++) {
		if (i === 4) await go('/');
		await settle(1000);
		have = (await kept()) ?? [];
	}
	check(
		OFFLINE.every((p) => have.includes(p)) &&
			OFFLINE.every((p) =>
				have.some((h) => h.endsWith('__data.json') && h.startsWith(p === '/' ? '/' : p))
			),
		`the worker keeps the offline screens and their data (${have.length} kept)`
	);

	const install = await send('Page.getInstallabilityErrors');
	const errors = install.result?.installabilityErrors ?? [];
	check(
		errors.length === 0,
		`Chrome finds it installable${errors.length ? `: ${errors.map((/** @type {{ errorId: string }} */ e) => e.errorId).join(', ')}` : ''}`
	);
	const manifest = await send('Page.getAppManifest');
	const parsed = JSON.parse(manifest.result?.data || '{}');
	check(
		(manifest.result?.errors ?? []).length === 0 &&
			!!parsed.name &&
			(parsed.icons ?? []).length > 0,
		`the manifest parses, named "${parsed.name ?? ''}", with ${(parsed.icons ?? []).length} icon(s)`
	);
	check((await queued())?.length === 0, 'the capture queue starts empty');
}

if (phase === 'offline') {
	for (const path of OFFLINE) {
		await go(path);
		const h = await heading();
		check(h !== '' && h !== 'No connection', `${path} opens with no server, as "${h}"`);
	}
	await go('/invoices');
	check((await heading()) === 'No connection', '/invoices says it needs a connection');

	// A timer, started and stopped with no server: the whole of capturing time.
	await go('/timesheet/start');
	await evaluate(`(() => {
		const s = document.querySelector('#s-service');
		s.value = [...s.options].find((o) => o.value)?.value ?? '';
		s.dispatchEvent(new Event('change', { bubbles: true }));
		const team = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Team');
		team?.click();
		const bill = document.querySelector('button.tog.on');
		bill?.click();
	})()`);
	await settle(300);
	check(await click('Start the clock'), 'the timer starts');
	await settle(1500);
	check((await stored('reckon.running')) === 1, 'it is running, on the phone');
	check(await click('Stop'), 'the timer stops');
	await settle(1500);
	check(
		(await stored('reckon.running')) === 0 && (await queued())?.length === 1,
		'its entry waits in the queue'
	);

	// The same entry again, but naming a service that is not there: an entry
	// recorded offline whose service someone deleted before the phone got back.
	const planted =
		await inQueue(`const store = db.transaction('queue', 'readwrite').objectStore('queue');
		const all = store.getAll();
		all.onsuccess = () => {
			const q = all.result[0];
			store.put({
				entry: { ...q.entry, client_uuid: crypto.randomUUID(), service_id: crypto.randomUUID(), minutes: 80 },
				queued_at: q.queued_at + 1
			});
			store.transaction.oncomplete = () => done(true);
		};
		all.onerror = () => done(false);`);
	check(
		planted === true && (await queued())?.length === 2,
		'one naming a deleted service waits beside it'
	);
}

if (phase === 'back') {
	await go('/timesheet');
	await settle(2500);
	const left = (await queued()) ?? [];
	check(
		left.length === 1 && left[0].refused !== null,
		'opening a page with the server back posts the queue'
	);
	check(
		left[0]?.refused === 'That service no longer exists.',
		`the one naming a deleted service is kept, with the reason "${left[0]?.refused ?? ''}"`
	);

	// Reload so the screen reads the queue as it now is.
	await go('/timesheet');
	const shown = await evaluate(`(() => {
		const sec = [...document.querySelectorAll('.sec')].find((s) => s.querySelector('h2')?.textContent?.trim() === 'Not saved');
		return sec ? sec.textContent.replace(/\\s+/g, ' ') : '';
	})()`);
	check(
		/That service no longer exists\./.test(shown) && /1:20/.test(shown),
		'Time shows it as not saved, with the reason'
	);

	await evaluate(
		`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Fix')?.click()`
	);
	await settle(2000);
	const form = await evaluate(`({
		heading: document.querySelector('h1')?.textContent?.trim() ?? '',
		duration: document.querySelector('#m-duration')?.value ?? '',
		service: document.querySelector('#m-service')?.selectedOptions[0]?.textContent?.trim() ?? ''
	})`);
	const filledIn =
		form.heading.startsWith('Fix an entry') &&
		form.duration === '1:20' &&
		form.service === 'Choose what was done';
	check(
		filledIn,
		`Fix opens it filled in, with the deleted service left to choose again${filledIn ? '' : ` (${JSON.stringify(form)})`}`
	);

	await go('/timesheet');
	await click('Discard');
	await settle(300);
	check((await queued())?.length === 1, 'one tap does not discard it');
	await click('Tap again to discard');
	await settle(800);
	check((await queued())?.length === 0, 'the second tap does');

	await evaluate(`document.querySelector('form[action="/logout"]')?.requestSubmit()`);
	await settle(2500);
	const after = await evaluate(`location.pathname`);
	const cached = (await kept()) ?? [];
	check(after === '/login' && cached.length === 0, 'signing out empties what the worker kept');
}

check(
	uncaught.length === 0,
	`nothing is left uncaught${uncaught.length ? `: ${[...new Set(uncaught)].join(' | ')}` : ''}`
);

ws.close();
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log(`\nOffline, ${phase}: as expected.`);
