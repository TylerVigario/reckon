#!/usr/bin/env node
/**
 * Proves a trip is recorded in the app: the stops in order, each drive's miles
 * before anyone types them, each leg given to whoever caused it, what the trip
 * bills and pays the vehicle it was driven in, and the trip as it is kept.
 *
 *   node tests/trips-check.mjs <base-url> <email> <password>
 *
 * Two trips on the demo. Harbor Light's Woodland office and then Valley Oak's
 * clinic, each drive starting as Sam drove it today, the way back the
 * clinic's. Then the
 * building on Maple Street, where Harbor Light and Pinecrest both have a site:
 * one stop, each way half the site's round trip and split between them, until
 * Pinecrest asked once the driver was there. The second is taken back again.
 *
 * Uses the browser on 9222, as console-check does.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node tests/trips-check.mjs <base-url> <email> <password>');
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
/**
 * Runs `fn` in the page with `args` handed to it as values. The function's
 * source is this file's own; nothing is written into it, so no value -- a
 * password, what is typed into a field -- can become code the page runs.
 */
const run = async (/** @type {Function} */ fn, /** @type {unknown[]} */ ...args) => {
	const page = await send('Runtime.evaluate', { expression: 'globalThis' });
	return (
		await send('Runtime.callFunctionOn', {
			objectId: page.result?.result?.objectId,
			functionDeclaration: fn.toString(),
			arguments: args.map((value) => ({ value })),
			awaitPromise: true,
			returnByValue: true
		})
	).result?.result?.value;
};
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

await go('/login');
if (await evaluate(`!!document.querySelector('input[name=password]')`)) {
	await run(
		(/** @type {string} */ who, /** @type {string} */ secret) => {
			const field = (/** @type {string} */ name) =>
				/** @type {HTMLInputElement} */ (document.querySelector(`input[name=${name}]`));
			field('email').value = who;
			field('password').value = secret;
			document.querySelector('form')?.requestSubmit();
		},
		email,
		password
	);
	await settle(2500);
}

/** A field set as a person sets it: its value, then the event the page listens for. */
const set = (/** @type {string} */ field, /** @type {string} */ value, event = 'input') =>
	run(
		(/** @type {string} */ selector, /** @type {string} */ v, /** @type {string} */ kind) => {
			const f = /** @type {HTMLInputElement} */ (document.querySelector(selector));
			f.value = v;
			f.dispatchEvent(new Event(kind, { bubbles: true }));
		},
		field,
		value,
		event
	);
/** A select set to the option that reads `label`. */
const choose = (/** @type {string} */ selector, /** @type {string} */ label) =>
	run(
		(/** @type {string} */ sel, /** @type {string} */ text) => {
			const s = /** @type {HTMLSelectElement} */ (document.querySelector(sel));
			s.value = [...s.options].find((o) => o.textContent?.trim() === text)?.value ?? '';
			s.dispatchEvent(new Event('change', { bubbles: true }));
			return s.value !== '';
		},
		selector,
		label
	);
const tap = (/** @type {string} */ label) =>
	run((/** @type {string} */ text) => {
		const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
		b?.click();
		return !!b;
	}, label);
const page = async () =>
	/** @type {string} */ (await evaluate(`document.querySelector('main')?.innerText ?? ''`));
const milesTyped = async () =>
	/** @type {string[]} */ (
		await evaluate(`[...document.querySelectorAll('.mi input')].map((i) => i.value)`)
	);
/** A stop at one of a client's sites, and -- when asked -- whoever else is at its address. */
const addStop = async (
	/** @type {string} */ client,
	/** @type {string} */ site,
	/** @type {string | null} */ alsoHere = null
) => {
	await tap('Add a stop');
	await settle(300);
	await choose('#s-client', client);
	await settle(200);
	await choose('#s-site', site);
	await settle(200);
	if (alsoHere) check(await tap('Add them'), `${alsoHere} is offered as here too`);
	await tap('Add the stop');
	await settle(400);
};

// ----------------------------------------------- A then B, in the Tacoma
await go('/trips/new');
await addStop('Harbor Light Dental', 'Woodland office');
await addStop('Valley Oak Veterinary', 'Clinic');
await settle(1200);
const typedFirst = await milesTyped();
const first = await page();
check(
	typedFirst.join(' ') === '21.0 22.0 14.0' && first.includes('as last driven'),
	`each drive starts as it was last driven (${typedFirst.join(', ')})`
);
check(
	/Harbor Light Dental\s+Base → Woodland office, caused by the first stop/.test(first) &&
		/Valley Oak Veterinary\s+Clinic → Base, the way back from the last stop/.test(first),
	"the drive out is the first client's, and the way back the last's"
);
const vehicle = /** @type {string} */ (
	await evaluate(
		`document.querySelector('#t-vehicle')?.selectedOptions[0]?.textContent?.trim() ?? ''`
	)
);
check(
	vehicle.startsWith('Tacoma'),
	`it starts in the driver's own vehicle, the Ranger being retired (${vehicle})`
);
check(
	first.includes('$37.62') &&
		first.includes('Avery Lind, for the Tacoma') &&
		first.includes('$33.86'),
	'it comes to $37.62, of which the Tacoma is paid $33.86'
);
await set('#t-left', '1000');
await set('#t-back', '1057');
await set('#t-note', 'Cable, then the clinic');
await settle(300);
// Chips and headings are set in capitals, and innerText says them so.
check(/as the legs say/i.test(await page()), 'the odometer agrees with the legs');
await tap('Save the trip');
await settle(2500);
const saved = /** @type {string} */ (await evaluate('location.pathname'));
const kept = await page();
check(
	/^\/trips\/[0-9a-f-]{36}$/.test(saved) &&
		kept.includes('Woodland office') &&
		/paid for the vehicle/i.test(kept) &&
		kept.includes('$33.86') &&
		kept.includes('odometer 1,000 → 1,057') &&
		kept.includes('Cable, then the clinic'),
	`it is kept as it was recorded (${saved})`
);

// ------------------------------------------- changed after it was saved
await run(() =>
	/** @type {HTMLAnchorElement | undefined} */ (
		[...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Change this trip')
	)?.click()
);
await settle(2500);
const before = await milesTyped();
const filledIn = /** @type {{ note: string; left: string; title: string }} */ (
	await evaluate(`({
		note: document.querySelector('#t-note')?.value ?? '',
		left: document.querySelector('#t-left')?.value ?? '',
		title: document.querySelector('main')?.innerText.includes('Change the trip') ? 'Change the trip' : ''
	})`)
);
check(
	before.join(' ') === '21 22 14' &&
		filledIn.note === 'Cable, then the clinic' &&
		filledIn.left === '1000' &&
		filledIn.title === 'Change the trip',
	`Change opens the trip as it was saved (${before.join(', ')}; ${filledIn.left}; ${filledIn.note})`
);
await run(() => {
	const second = /** @type {HTMLInputElement} */ (document.querySelectorAll('.mi input')[1]);
	second.value = '25';
	second.dispatchEvent(new Event('input', { bubbles: true }));
});
await set('#t-back', '1060');
await set('#t-note', 'Cable, then the clinic, the long way');
await settle(1200);
await tap('Save the trip');
await settle(2500);
const changed = await page();
check(
	(await evaluate('location.pathname')) === saved &&
		changed.includes('$16.50') &&
		changed.includes('$39.60') &&
		changed.includes('the long way'),
	'the change is saved, and its legs worked out again'
);

// -------------------------------------------- one building, two clients
await go('/trips/new');
await addStop('Harbor Light Dental', 'Main Street office', 'Pinecrest Insurance');
await settle(1200);
const shared = await page();
check(
	shared.includes('101 Maple St, Auburn') &&
		/Harbor Light Dental and Pinecrest Insurance\s+Base → 101 Maple St, Auburn, split between them/.test(
			shared
		) &&
		(await milesTyped()).join(' ') === '32.0 32.0' &&
		shared.includes("half the site's round trip"),
	"two clients at one address are one stop, the drive is half the site's round trip each way, and it is split between them"
);
await tap('Pinecrest asked once there');
await settle(1200);
const once = await page();
check(
	/Harbor Light Dental\s+Base → 101 Maple St, Auburn, out and back for one client/.test(once),
	'a client who asked once the driver was there pays for none of it'
);
await tap('Save the trip');
await settle(2500);
const second = await page();
check(
	second.includes('101 Maple St, Auburn') &&
		second.includes('Pinecrest Insurance · Suite 210 · asked once there'),
	'the stop is kept with both, and who asked once there'
);
await tap('Remove this trip');
await settle(2000);
check((await evaluate('location.pathname')) === '/trips', 'a trip recorded wrongly is taken back');

check(
	uncaught.length === 0,
	`nothing is left uncaught${uncaught.length ? `: ${[...new Set(uncaught)].join(' | ')}` : ''}`
);

ws.close();
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log('\nA trip is recorded: its stops, its legs to whoever caused them, and what it pays.');
