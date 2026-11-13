#!/usr/bin/env node
/**
 * Proves stock is received in the app as a receipt or invoice says it: what it
 * prints once, each item on it, its tax split over them, who paid, and the
 * receipt itself.
 *
 *   node tests/receive-check.mjs <base-url> <email>
 *
 * A material new to the catalogue is named on the form with the unit it is
 * counted in; a quantity with more places than the unit counts in is refused
 * before anything is sent; another item, bought in packs at a price each, is
 * broken down into the material's own unit; what one costs and sells at, and
 * the receipt's total, show as they are typed; and a photo, large as a phone's
 * camera makes them, arrives shrunk. The receipt is read back from its own
 * page, with each item's share of the tax, and the file from its link.
 *
 * Uses the browser on 9222, as console-check does.
 */
import { signIn } from './passkeys.mjs';
const [, , base, email] = process.argv;
if (!base || !email) {
	console.error('usage: node tests/receive-check.mjs <base-url> <email>');
	process.exit(2);
}

/** The material named here, so its page can be found again. */
const NAME = 'Cable received by receive-check';

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
 * name, what is typed into a field -- can become code the page runs.
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

// Signed in with the passkey tests/passkeys.mjs gave them, its session handed to the browser.
{
	const { name, value } = await signIn(base, email);
	await send('Network.setCookie', {
		name,
		value,
		url: base,
		httpOnly: true,
		sameSite: 'Lax',
		// A __Secure- cookie must say it is Secure, as Better Auth sets it; Chrome
		// keeps one for localhost over http, a secure context.
		secure: name.startsWith('__Secure-')
	});
}
await go('/catalogue/receipts/new');

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
const choose = (/** @type {string} */ field, /** @type {string} */ label) =>
	run(
		(/** @type {string} */ selector, /** @type {string} */ want) => {
			const s = /** @type {HTMLSelectElement} */ (document.querySelector(selector));
			s.value = [...s.options].find((o) => o.textContent?.trim() === want)?.value ?? '';
			s.dispatchEvent(new Event('change', { bubbles: true }));
		},
		field,
		label
	);
const textOf = (/** @type {string} */ selector) =>
	run(
		(/** @type {string} */ sel) =>
			document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
		selector
	);
const submit = () => evaluate(`document.querySelector('#receive button.btn.pri').click()`);
/** A button on the page, or in the dialog that is open, by what it says. */
const press = (/** @type {string} */ label) =>
	run((/** @type {string} */ want) => {
		const b = /** @type {HTMLButtonElement | undefined} */ (
			[...document.querySelectorAll('dialog[open] button, #receive button')].find(
				(x) => x.textContent?.trim() === want
			)
		);
		b?.click();
		return !!b;
	}, label);
const dialogOpen = () => evaluate(`!!document.querySelector('dialog[open]')`);

// A Delta Wholesale invoice: what it prints once, and who paid it.
await set('#r-from', 'Delta Wholesale');
await set('#r-ref', 'INV-77001');
await set('#r-tax', '30.00');
const payer = /** @type {string} */ (
	await run(() => {
		const s = /** @type {HTMLSelectElement} */ (document.querySelector('#r-paid'));
		s.selectedIndex = 1;
		s.dispatchEvent(new Event('change', { bubbles: true }));
		return s.selectedOptions[0]?.textContent?.trim() ?? '';
	})
);

// The receipt and its items are two tabs of one form: Items opens its own part.
await evaluate(`document.querySelector('#rcv-tab-items').click()`);
await settle(300);
check(
	/** @type {boolean} */ (
		await evaluate(`document.querySelector('#rcv-panel-receipt').hidden &&
			!document.querySelector('#rcv-panel-items').hidden &&
			document.querySelector('#rcv-tab-items').getAttribute('aria-selected') === 'true'`)
	),
	'the receipt and its items are tabs of one form'
);

// Its first item, something new, counted in feet, in the dialog an item opens in.
check(await press('Add an item'), 'an item is added in a dialog');
await settle(400);
await set('#d-item', '', 'change');
await settle(300);
await set('#d-name', NAME);
await choose('#d-unit', 'foot');
await set('#d-price', '310.00');
await set('#d-count', '147.555');
await press('Add item');
await settle(400);
const refused = /** @type {string} */ (await textOf('dialog[open]'));
check(
	(await dialogOpen()) && /At most 2 decimal places in this unit\./.test(refused),
	`a quantity with more places than its unit is refused, and the item stays open${refused ? '' : ' (nothing said)'}`
);

await set('#d-count', '1000');
await settle(300);
const first = /** @type {string} */ (await textOf('[data-shelf]'));
// A foot at $0.31 sells at the business's markup over it: at 25%, $0.3875.
const markup = Number(/(\d+)% markup/.exec(first)?.[1] ?? NaN);
const tenThousandths = 31 * (100 + markup);
const sells = `$0.${String(tenThousandths)
	.padStart(4, '0')
	.replace(/0{1,2}$/, '')}`;
check(
	first.includes('1,000 ft for $310.00') && first.includes('$0.31 a ft') && first.includes(sells),
	`what a foot cost and sells at shows as it is typed${first ? ` (${first})` : ', but nothing shows'}`
);
await press('Add item');
await settle(400);
check(
	!(await dialogOpen()) && (await textOf('[data-item="0"]')).includes(NAME),
	'it goes on the receipt as a row'
);

// Another item on the same invoice: patch leads, two packs of ten at 38.50 a pack.
await press('Add an item');
await settle(400);
await choose('#d-item', 'Fibre patch lead · LC-LC · 3 m');
await set('#d-count', '2');
await set('#d-per', '10');
await set('#d-price', '38.50');
await run(() =>
	/** @type {HTMLInputElement | null} */ (
		document.querySelector('dialog[open] input[name="d-for"][value="each"]')
	)?.click()
);
await settle(300);
const second = /** @type {string} */ (await textOf('[data-shelf]'));
check(
	second.includes('20 each for $77.00') && second.includes('$3.85 each'),
	`two packs of ten at a price each are twenty, each at a tenth of a pack (${second})`
);
await press('Add item');
await settle(400);
const total = /** @type {string} */ (await textOf('[data-total]'));
check(total.includes('$417.00'), `the receipt's total adds up as it is typed (${total})`);

// A photo as large as a phone camera makes, drawn here and attached.
const original = await evaluate(`(async () => {
	const c = document.createElement('canvas');
	c.width = 4000;
	c.height = 3000;
	const g = c.getContext('2d');
	for (let i = 0; i < 400; i++) {
		g.fillStyle = 'hsl(' + ((i * 37) % 360) + ' 60% 50%)';
		g.fillRect((i * 97) % 4000, (i * 61) % 3000, 300, 200);
	}
	const blob = await new Promise((done) => c.toBlob(done, 'image/png'));
	const input = document.querySelector('#r-receipt');
	const t = new DataTransfer();
	t.items.add(new File([blob], 'receipt.png', { type: 'image/png' }));
	input.files = t.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	return blob.size;
})()`);
await settle(500);
await submit();
await settle(4000);

const at = /** @type {string} */ (await evaluate('location.pathname'));
check(/^\/catalogue\/receipts\/[0-9a-f-]{36}$/.test(at), 'it is received, and opens the receipt');
const page = /** @type {string} */ (
	await evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`)
);
// The tax split by what each cost: 310.00 and 77.00 of 387.00, so 24.03 and
// what is left, 5.97.
check(
	page.includes('Delta Wholesale') &&
		page.includes('INV-77001') &&
		page.includes(`paid by ${payer}`) &&
		page.includes(NAME) &&
		page.includes('1,000 ft for $310.00, and $24.03 tax') &&
		page.includes('20 each for $77.00, and $5.97 tax') &&
		page.includes('$417.00'),
	'the receipt reads as it was printed: each item, its share of the tax, who paid, the total'
);
const receipt = await evaluate(`(async () => {
	const a = [...document.querySelectorAll('a')].find((a) => a.textContent.trim().startsWith('The receipt'));
	if (!a) return null;
	const r = await fetch(a.href);
	return { status: r.status, type: r.headers.get('content-type'), size: (await r.blob()).size };
})()`);
check(
	receipt?.status === 200 && receipt.type === 'image/jpeg' && receipt.size < original,
	`the receipt is kept, shrunk on the phone${receipt ? ` (${Math.round(original / 1024)} KB → ${Math.round(receipt.size / 1024)} KB)` : ', but there is no link to it'}`
);

// The new material's page has the lot, which opens the receipt it came on.
await evaluate(
	`[...document.querySelectorAll('a.box-row')].find((a) => a.textContent.includes(${JSON.stringify(NAME)}))?.click()`
);
await settle(2000);
const material = /** @type {string} */ (
	await evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`)
);
check(
	material.includes(NAME) &&
		material.includes('Delta Wholesale · INV-77001') &&
		material.includes('1,000 ft for $310.00, and $24.03 tax'),
	'the material keeps the lot, named for the receipt it came on'
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
	'\nStock is received as its receipt says it: each item, the tax split, who paid and the paper.'
);
