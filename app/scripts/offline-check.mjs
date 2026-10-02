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
 *            which leaves an entry in the queue.
 *   back     opens a page, which posts the queue; signs out, which must empty
 *            the cache the worker kept.
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
ws.onmessage = (/** @type {{ data: string }} */ m) => {
	const x = JSON.parse(m.data);
	if (x.id && waiting.has(x.id)) waiting.get(x.id)(x);
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
const ok = (/** @type {string} */ what) => console.log(`  ✓ ${what}`);
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
	check((await stored('reckon.queue')) === 0, 'the capture queue starts empty');
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
		(await stored('reckon.running')) === 0 && (await stored('reckon.queue')) === 1,
		'its entry waits in the queue'
	);
}

if (phase === 'back') {
	await go('/timesheet');
	await settle(2500);
	check(
		(await stored('reckon.queue')) === 0,
		'opening a page with the server back posts the queue'
	);

	await evaluate(`document.querySelector('form[action="/logout"]')?.requestSubmit()`);
	await settle(2500);
	const after = await evaluate(`location.pathname`);
	const left = (await kept()) ?? [];
	check(after === '/login' && left.length === 0, 'signing out empties what the worker kept');
}

ws.close();
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
console.log(`\nOffline, ${phase}: as expected.`);
