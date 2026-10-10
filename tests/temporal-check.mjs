#!/usr/bin/env node
/**
 * Proves a browser without Temporal gets the polyfill, works, and keeps it for
 * offline -- and that one with Temporal never fetches it.
 *
 *   node tests/temporal-check.mjs <base-url> <email> <password>
 *
 * The browser CI and development use has Temporal of its own, so nothing else
 * here ever takes the path a phone without it takes (hooks.client.ts). This
 * takes it on purpose: before any of the page's scripts run, Temporal is
 * removed from the page, and the app has to bring its own.
 *
 * Uses the browser on 9222, as console-check does, after it: the service worker
 * is installed by then, and its cache of the app's files is what is checked.
 * Leaves the browser as it found it.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node tests/temporal-check.mjs <base-url> <email> <password>');
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
/** @type {string[]} */
const complaints = [];
ws.onmessage = (/** @type {{ data: string }} */ m) => {
	const x = JSON.parse(m.data);
	if (x.id && waiting.has(x.id)) waiting.get(x.id)(x);
	if (x.method === 'Runtime.exceptionThrown') {
		const d = x.params.exceptionDetails;
		complaints.push(`uncaught: ${(d.exception?.description ?? d.text).split('\n')[0]}`);
	}
	if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error')
		complaints.push(
			`console.error: ${x.params.args
				.map(
					(/** @type {{ description?: string; value?: unknown }} */ a) => a.description ?? a.value
				)
				.join(' ')
				.slice(0, 200)}`
		);
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
const settle = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

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
	await settle(2500);
};

/** The app's own scripts this page load fetched, by pathname. */
const scripts = async () =>
	/** @type {string[]} */ (
		await evaluate(`performance.getEntriesByType('resource')
			.map((e) => new URL(e.name).pathname)
			.filter((p) => p.includes('/_app/immutable/') && p.endsWith('.js'))`)
	);
/** Whether this page's Temporal is the browser's own or the polyfill, and whether it works. */
const temporal = () =>
	evaluate(`(() => {
		if (typeof Temporal !== 'object') return { here: false };
		return {
			here: true,
			native: Function.prototype.toString.call(Temporal.PlainDate).includes('[native code]'),
			leap: Temporal.PlainDate.from('2028-02-28').add({ days: 1 }).toString()
		};
	})()`);

await send('Page.enable');
await send('Runtime.enable');
if (base.startsWith('http:'))
	await send('Network.enable').then(() =>
		send('Network.setExtraHTTPHeaders', { headers: { 'x-forwarded-proto': 'http' } })
	);

/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ pass, /** @type {string} */ what) =>
	pass ? console.log(`  ✓ ${line(what)}`) : failures.push(what);

/** @type {string | undefined} */
let removal;
try {
	// Signed in, in the browser as it is.
	await go('/login');
	if (await evaluate(`!!document.querySelector('input[name=password]')`)) {
		await evaluate(`(() => {
			document.querySelector('input[name=email]').value = ${JSON.stringify(email)};
			document.querySelector('input[name=password]').value = ${JSON.stringify(password)};
			document.querySelector('form').requestSubmit();
		})()`);
		await settle(2500);
	}
	await go('/');
	const own = await temporal();
	const plain = new Set(await scripts());
	// Whether the browser has Temporal is the browser's business. Without it,
	// there is no "its own" to compare against, and that half is said to be
	// skipped rather than failed.
	const hasOwn = own?.here === true && own.native === true;
	if (hasOwn) check(true, 'a browser with Temporal keeps its own');
	else console.log('  - this browser has no Temporal of its own: that half is skipped');

	// The same browser, as one without Temporal: it is gone before any of the
	// page's scripts run.
	removal = (
		await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete globalThis.Temporal;' })
	).result?.identifier;
	await go('/');
	const brought = await temporal();
	const fetched = await scripts();
	const extra = fetched.filter((p) => !plain.has(p));
	check(
		brought?.here === true && brought.native === false && brought.leap === '2028-02-29',
		`one without it gets the polyfill, which works (${JSON.stringify(brought)})`
	);
	if (hasOwn)
		check(
			extra.length > 0,
			`and fetches it only then: ${extra.length} more script(s) than with Temporal of its own`
		);

	// Kept for offline: every script that load fetched, the polyfill with them,
	// is in the worker's copy of the app's files.
	const shell = /** @type {string[] | null} */ (
		await evaluate(`(async () => {
			await navigator.serviceWorker.ready;
			for (let i = 0; i < 20; i++) {
				const name = (await caches.keys()).find((k) => k.startsWith('shell-'));
				if (name) return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
				await new Promise((r) => setTimeout(r, 500));
			}
			return null;
		})()`)
	);
	const missing = shell ? fetched.filter((p) => !shell.includes(p)) : fetched;
	check(
		shell !== null && missing.length === 0,
		`and the worker keeps it for offline${missing.length ? `; not kept: ${missing.join(', ')}` : ''}`
	);

	// Every screen that works offline, and the ones whose dates moved to
	// Temporal, opened without Temporal of the browser's own.
	complaints.length = 0;
	for (const path of [
		'/',
		'/timesheet',
		'/timesheet/start',
		'/timesheet/manual',
		'/timesheet/all',
		'/trips',
		'/unbilled'
	]) {
		await go(path);
		const h = await evaluate(`document.querySelector('h1')?.textContent?.trim() ?? ''`);
		check(h !== '', `${path} opens with the polyfill, as "${h}"`);
	}
	check(
		complaints.length === 0,
		`with nothing on the console${complaints.length ? `: ${complaints.join(' | ')}` : ''}`
	);
} finally {
	if (removal) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: removal });
	await go('/');
	ws.close();
}

if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log('\nA browser without Temporal gets the polyfill, and keeps it for offline.');
