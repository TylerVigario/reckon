#!/usr/bin/env node
/**
 * Proves a person's time zone comes from their browser, and that travel asks.
 *
 *   node scripts/zone-check.mjs <base-url> <email> <password>
 *
 * A person's zone is on their user record (#lib/server/calendar). The first
 * time they sign in it is taken from the browser without asking. After that, a
 * phone in another zone asks before changing it, and remembers being told no.
 *
 * Uses the browser on 9222, as console-check does, and makes it look like it is
 * somewhere else with Emulation.setTimezoneOverride -- the zone Intl reports,
 * which is all the app asks. Reads the stored zone back through HTTP, from
 * /settings/people. Puts the person's zone back as it was found.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node scripts/zone-check.mjs <base-url> <email> <password>');
	process.exit(2);
}

/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

/** The value chosen in the list with this id, as the server drew it. */
const chosen = (/** @type {string} */ html, /** @type {string} */ id) => {
	const list = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1];
	return list ? (/<option value="([^"]*)" selected/.exec(list)?.[1] ?? '') : null;
};

// HTTP, for setting things up and reading them back.
const signedIn = await fetch(base + '/login', {
	method: 'POST',
	body: new URLSearchParams({ email, password, next: '/' }),
	redirect: 'manual',
	headers: { origin: base, accept: 'text/html', ...PROXY }
});
const cookie = (signedIn.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const people = await (await fetch(base + '/settings/people', { headers: { cookie } })).text();
const mine = people.split(/(?=id="set-[0-9a-f-]{36}-role_id")/).find((b) => b.includes(email));
const me = mine && /id="set-([0-9a-f-]{36})-role_id"/.exec(mine)?.[1];
if (!me) {
	console.error('  could not find who is signed in on /settings/people');
	process.exit(1);
}
const stored = async () => {
	const html = await (await fetch(base + '/settings/people', { headers: { cookie } })).text();
	return chosen(html, `set-${me}-timezone`);
};
const setOwn = (/** @type {string} */ zone) =>
	fetch(`${base}/api/people/${me}`, {
		method: 'PATCH',
		headers: { cookie, 'content-type': 'application/json', origin: base, ...PROXY },
		body: JSON.stringify({ fields: { timezone: zone } })
	});
const before = (await stored()) ?? '';

// The browser.
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
const zone = (/** @type {string} */ timezoneId) =>
	send('Emulation.setTimezoneOverride', { timezoneId });
const asking = () =>
	evaluate(
		`[...document.querySelectorAll('.zone-ask')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()).find((t) => t.startsWith('This device is on')) ?? ''`
	);
const press = (/** @type {string} */ starts) =>
	evaluate(`(() => {
		const b = [...document.querySelectorAll('.zone-ask button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(starts)}));
		if (!b) return false;
		b.click();
		return true;
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

try {
	// Signed in in this browser, as a person whose zone has never been set.
	await setOwn('');
	await zone('America/Chicago');
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
	await settle(1000);
	check(
		(await stored()) === 'America/Chicago',
		`the first time, the zone is taken from the browser (${await stored()})`
	);
	check((await asking()) === '', 'and it does not ask to');

	// The phone is somewhere else now: it asks, and changes nothing yet.
	await zone('Asia/Tokyo');
	await go('/');
	const asked = await asking();
	check(
		asked.includes('Japan') && (await stored()) === 'America/Chicago',
		`a phone in another zone asks first: "${asked}"`
	);
	check(await press('Keep mine'), 'keeping your own zone is one tap');
	await go('/');
	check(
		(await asking()) === '' && (await stored()) === 'America/Chicago',
		'told no, it does not ask again for that zone'
	);

	// Somewhere else again, and this time the person takes it.
	await zone('Europe/Paris');
	await go('/');
	check((await asking()).includes('Central European'), 'a new zone asks again');
	check(await press('Use '), 'using the zone the phone is in is one tap');
	await settle(2500);
	check((await stored()) === 'Europe/Paris', `and it becomes theirs (${await stored()})`);
	await go('/');
	check((await asking()) === '', 'after which there is nothing to ask');
} finally {
	await setOwn(before);
	await send('Emulation.setTimezoneOverride', { timezoneId: '' });
	ws.close();
}

if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log("\nA person's zone comes from their browser, and travel asks first.");
