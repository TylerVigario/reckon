#!/usr/bin/env node
/**
 * Proves lines are added to a draft: goods drawn from stock, goods bought for
 * the job, and a cost paid on the client's behalf, each bought or paid for
 * saying who paid, with a receipt.
 *
 *   node scripts/lines-check.mjs <base-url> <email> <password>
 *
 * A draft is started for a client, which takes the next invoice number. 10 ft
 * of raceway drawn from the 60 ft on the shelf, at the average of $0.85 a foot
 * and the demo's 25% markup; jacks bought at Valley Hardware for 33.33 with
 * 2.67 tax, passed on as they cost; both taxed at the site's 8%; and a 35.00
 * permit paid for them, untaxed. What a line will bill shows as it is typed, a
 * draw larger than the shelf is refused before it is sent, the receipt is read
 * back from its link, and the raceway's shelf is 10 ft shorter.
 *
 * Uses the browser on 9222, as console-check does.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node scripts/lines-check.mjs <base-url> <email> <password>');
	process.exit(2);
}

/** The client, the site whose rate the goods are taxed at, and what is drawn. */
const CLIENT = 'Harbor Light Dental';
const SITE = 'Woodland office';
const RACEWAY = 'Raceway · Surface · 3/4 in';

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
/** An option chosen by what it says. */
const choose = (/** @type {string} */ field, /** @type {string} */ label) =>
	run(
		(/** @type {string} */ selector, /** @type {string} */ text) => {
			const s = /** @type {HTMLSelectElement} */ (document.querySelector(selector));
			s.value = [...s.options].find((o) => o.textContent?.trim() === text)?.value ?? '';
			s.dispatchEvent(new Event('change', { bubbles: true }));
		},
		field,
		label
	);
/** A button pressed by what it says. */
const press = (/** @type {string} */ label) =>
	run((/** @type {string} */ text) => {
		const b = [...document.querySelectorAll('button, a')].find(
			(x) => x.textContent?.trim() === text
		);
		/** @type {HTMLElement | undefined} */ (b)?.click();
		return !!b;
	}, label);
const formText = () =>
	evaluate(`document.querySelector('form.form')?.textContent.replace(/\\s+/g, ' ') ?? ''`);

// A draft for the client.
await go('/invoices/new');
await choose('#n-client', CLIENT);
await press('Start the draft');
await settle(3000);
const draft = /** @type {string} */ (await evaluate('location.pathname'));
const heading = /** @type {string} */ (
	await evaluate(`document.querySelector('h1')?.textContent ?? ''`)
);
check(
	/^\/invoices\/[0-9a-f-]{36}$/.test(draft) && /\d/.test(heading),
	`a draft is started, and takes a number${/\d/.test(heading) ? ` (${heading.trim()})` : ''}`
);

// Raceway off the shelf: stock comes first where there is any.
await press('Add a line');
await settle(2500);
check(
	(await evaluate(`document.querySelector('.seg button.on')?.textContent.trim()`)) === 'From stock',
	'a line is from stock unless it is said otherwise'
);
await choose('#l-site', SITE);
await set('#l-find', 'raceway');
await settle(200);
const picked = await run((/** @type {string} */ name) => {
	const b = [...document.querySelectorAll('.pick button.rec')].find(
		(x) => x.querySelector('.rec-t')?.textContent?.trim() === name
	);
	/** @type {HTMLElement | undefined} */ (b)?.click();
	return !!b;
}, RACEWAY);
await set('#l-qty', '1000');
await settle(300);
const short = /** @type {string} */ (await formText());
check(
	picked && short.includes('Only 60 ft on the shelf.'),
	`more than is on the shelf is refused as it is typed${picked ? '' : ', but the raceway is not offered'}`
);
await set('#l-qty', '10');
await settle(300);
const drew = /** @type {string} */ (await formText());
const named = await evaluate(`document.querySelector('#l-desc')?.value`);
const costed =
	drew.includes('$10.63, $1.0625 per ft') &&
	drew.includes('$0.85 at 8.000%') &&
	drew.includes('$8.50 and') &&
	drew.includes('at the average') &&
	drew.includes('Left after 50 ft');
check(
	costed && named === RACEWAY,
	`10 ft is costed at the average, marked up, taxed, and named after the item${costed ? '' : ` (${drew})`}`
);
await press('Add the line');
await settle(3000);
check((await evaluate('location.pathname')) === draft, 'the line is drawn, and the draft opens');

// Goods bought for the job, paid for by the first person on the list.
await press('Add a line');
await settle(2500);
await press('Bought');
await settle(200);
await choose('#l-site', SITE);
await set('#l-desc', 'Keystone jacks ×12, faceplates ×3');
await set('#l-from', 'Valley Hardware');
await set('#l-cost', '33.33');
await set('#l-tax', '2.67');
await settle(300);
const preview = /** @type {string} */ (
	await evaluate(`document.querySelector('.bill')?.textContent.replace(/\\s+/g, ' ') ?? ''`)
);
const previewed = preview.includes('$33.33') && preview.includes('$2.67 at 8.000%');
check(
	previewed,
	`what it will bill, and its tax, shows as it is typed${previewed ? '' : ` (${preview})`}`
);
const payer = /** @type {string} */ (
	await evaluate(`(() => {
		const b = [...document.querySelectorAll('.seg')][1]?.querySelector('button');
		b?.click();
		return b?.textContent?.trim() ?? '';
	})()`)
);
await evaluate(`(async () => {
	const c = document.createElement('canvas');
	c.width = 1200;
	c.height = 1600;
	c.getContext('2d').fillRect(100, 100, 400, 300);
	const blob = await new Promise((done) => c.toBlob(done, 'image/png'));
	const input = document.querySelector('#l-receipt');
	const t = new DataTransfer();
	t.items.add(new File([blob], 'receipt.png', { type: 'image/png' }));
	input.files = t.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await settle(300);
await press('Add the line');
await settle(3000);
check((await evaluate('location.pathname')) === draft, 'the line is added, and the draft opens');

// A permit paid for them, by the business.
await press('Add a line');
await settle(2500);
await press('Paid for them');
await settle(200);
await choose('#l-site', SITE);
await set('#l-desc', 'Low-voltage permit');
await set('#l-from', 'City of Woodland');
await set('#l-cost', '35.00');
await settle(300);
const untaxed = /** @type {string} */ (await formText());
check(
	untaxed.includes('$35.00, at cost') && untaxed.includes('Tax none'),
	'a cost paid for them bills at cost, untaxed'
);
await press('Add the line');
await settle(3000);

const page = /** @type {string} */ (
	await evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`)
);
// The buttons say first names; the line says the whole one.
const said =
	page.includes(`Bought · Valley Hardware · ${payer}`) &&
	/Bought · Valley Hardware · [^·]+ paid · taxable/.test(page) &&
	page.includes('Paid for them · City of Woodland · the business paid · at cost');
check(
	said && page.includes('From stock · Delta Wholesale · taxable'),
	`each line says what it is, from whom, and who paid${said ? '' : ` (${page.slice(0, 600)})`}`
);
// Each was saved on the phone first, and sent at once: none is left there.
check(
	!page.includes('On this phone'),
	'every line reached the server, and none waits on the phone'
);
// 33.33 and 10.63 taxed at 8% is 3.5168: $3.52.
check(page.includes('$82.48'), 'the draft comes to $82.48: $10.63, $33.33, $35.00 and $3.52 tax');
const receipt = await evaluate(`(async () => {
	const a = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'The receipt');
	if (!a) return null;
	const r = await fetch(a.href);
	return { status: r.status, type: r.headers.get('content-type') };
})()`);
check(
	receipt?.status === 200 && receipt.type === 'image/jpeg',
	`the receipt is kept on its line${receipt ? '' : ', but there is no link to it'}`
);

await go('/catalogue/materials');
const shelf = await run((/** @type {string} */ name) => {
	const row = [...document.querySelectorAll('.rec')].find(
		(r) => r.querySelector('.rec-t')?.textContent?.trim() === name
	);
	return row?.querySelector('.rec-x')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}, RACEWAY);
check(
	shelf === '50 ft',
	`the raceway's shelf is 10 ft shorter${shelf === '50 ft' ? '' : ` (${shelf})`}`
);

check(
	uncaught.length === 0,
	`nothing is left uncaught${uncaught.length ? `: ${[...new Set(uncaught)].join(' | ')}` : ''}`
);

ws.close();
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log(
	'\nLines are added to a draft: drawn from stock, and bought or paid for with receipts.'
);
