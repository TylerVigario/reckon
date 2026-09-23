#!/usr/bin/env node
/**
 * Clicks through the app in a real browser and fails on anything the console
 * complains about.
 *
 *   node scripts/console-check.mjs <base-url> <email> <password>
 *
 * WHY THIS EXISTS, ON TOP OF smoke.mjs. smoke asks every route for a status
 * code, and a page can answer 200 with its body already doomed: SvelteKit
 * navigates on the client, and a component that throws while rendering leaves
 * the URL changed, the PREVIOUS screen's header on screen, and nothing else --
 * no fields, no buttons, no way out. It looks like the app flickering between
 * two screens. The server saw a 200 and so did smoke.
 *
 * That is exactly how `each_key_duplicate` reached Tyler's screen: a site's
 * CDTFA answers were keyed by date-and-rate, the refresh had been run twice in
 * a day, and two identical keys killed the whole render. Nothing on the server
 * side could see it.
 *
 * So this navigates the way a person does -- by clicking -- and treats any
 * console error or uncaught exception as a failure.
 */
const [, , base = 'http://127.0.0.1:5181', email, password] = process.argv;

const DEVTOOLS = 'http://127.0.0.1:9222/json';

/** @type {{ type: string; webSocketDebuggerUrl: string }[]} */
const targets = await (await fetch(DEVTOOLS)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) {
	console.error('No browser on 9222. Start headless_shell with --remote-debugging-port=9222.');
	process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const waiting = new Map();
const complaints = [];

ws.onmessage = (/** @type {{ data: string }} */ m) => {
	const x = JSON.parse(m.data);
	if (x.id && waiting.has(x.id)) waiting.get(x.id)(x);
	if (x.method === 'Runtime.exceptionThrown') {
		const d = x.params.exceptionDetails;
		complaints.push(`uncaught: ${(d.exception?.description ?? d.text).split('\n')[0]}`);
	}
	if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') {
		complaints.push(
			`console.error: ${x.params.args
				.map(
					(/** @type {{ description?: string; value?: unknown }} */ a) => a.description ?? a.value
				)
				.join(' ')
				.slice(0, 200)}`
		);
	}
};

const send = (/** @type {string} */ method, /** @type {Record<string, unknown>} */ params = {}) =>
	new Promise((res) => {
		const n = ++id;
		waiting.set(n, res);
		ws.send(JSON.stringify({ id: n, method, params }));
	});

await send('Page.enable');
await send('Runtime.enable');

const evaluate = async (/** @type {string} */ expression) =>
	(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
		?.result?.value;

const settle = (ms = 1800) => new Promise((r) => setTimeout(r, ms));
const go = async (/** @type {string} */ path) => {
	await send('Page.navigate', { url: base + path });
	await settle(2200);
};

await send('Emulation.setDeviceMetricsOverride', {
	width: 1440,
	height: 900,
	deviceScaleFactor: 1,
	mobile: false
});

await go('/login');
await evaluate(`(() => {
  document.querySelector('input[name=email]').value = ${JSON.stringify(email)};
  document.querySelector('input[name=password]').value = ${JSON.stringify(password)};
  for (const n of ['email','password'])
    document.querySelector('input[name='+n+']').dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('form').requestSubmit();
})()`);
await settle(2400);

const signedIn = await evaluate(`!document.querySelector('input[name="password"]')`);
if (!signedIn) {
	console.error('  could not sign in — every check below would pass for the wrong reason');
	process.exit(1);
}

// Every screen the app links to, reached by clicking rather than by loading:
// a client-side render is where this class of fault lives.
const seen = new Set(['/login', '/logout']);
const queue = ['/'];
let visited = 0;

while (queue.length) {
	const path = queue.shift();
	// The loop condition already proves there is one; this says so to the
	// checker rather than asserting it away.
	if (path === undefined || seen.has(path)) continue;
	seen.add(path);

	const before = complaints.length;
	await go(path);

	// What the page renders AFTER the client has had its say. A screen that
	// threw leaves its header belonging to somewhere else.
	const state = await evaluate(`JSON.stringify({
		url: location.pathname,
		heading: document.querySelector('.top h1')?.textContent?.trim().slice(0, 40) ?? null,
		links: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href'))
	})`);
	const { url, heading, links } = JSON.parse(state);
	visited++;

	if (url !== path) complaints.push(`${path}: ended up at ${url}`);
	if (!heading) complaints.push(`${path}: rendered no heading`);

	const fresh = complaints.length - before;
	console.log(`  ${fresh ? '✗' : '✓'} ${path}${heading ? `  ${heading}` : ''}`);

	for (const href of links) {
		const clean = href.split('#')[0];
		if (clean.startsWith('/') && !seen.has(clean) && !queue.includes(clean)) queue.push(clean);
	}
}

ws.close();

console.log('');
if (complaints.length) {
	console.error(`${complaints.length} problem(s) across ${visited} screen(s):`);
	for (const c of [...new Set(complaints)]) console.error(`  ${c}`);
	process.exit(1);
}
console.log(`${visited} screens clicked through, nothing on the console.`);
