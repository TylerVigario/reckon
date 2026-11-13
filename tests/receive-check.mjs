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
			[...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === want)
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
await run(
	(/** @type {string} */ name) =>
		/** @type {HTMLAnchorElement | undefined} */ (
			[...document.querySelectorAll('a.box-row')].find((a) => a.textContent?.includes(name))
		)?.click(),
	NAME
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

// PUT RIGHT BY HAND: 10 ft used in the shop, off the shelf at what it cost.
/** The line under the material's name: what is on hand, and what it sells at. */
const head = () => textOf('.rh');
await press('Adjust');
await settle(400);
await set('#a-qty', '10');
await set('#a-note', 'Run to the bench');
await press('Take it off');
await settle(2000);
check(
	!(await dialogOpen()) && (await head()).includes('990 ft on hand'),
	`10 ft used in the shop come off the shelf (${await head()})`
);

// More than the shelf holds is refused, and the dialog stays open to say so.
await press('Adjust');
await settle(400);
await set('#a-qty', '5000');
await press('Take it off');
await settle(1500);
const tooMuch = /** @type {string} */ (await textOf('dialog[open]'));
check(
	(await dialogOpen()) && tooMuch.includes(`Only 990 ft of ${NAME} is on the shelf.`),
	`taking off more than is there is refused (${tooMuch.slice(0, 200)})`
);
await press('Cancel');
await settle(300);

// 5 ft found, put on at what one on the shelf is worth now.
await press('Adjust');
await settle(400);
await run(() =>
	/** @type {HTMLInputElement | null} */ (
		document.querySelector('dialog[open] input[name="a-way"][value="on"]')
	)?.click()
);
await settle(200);
await set('#a-qty', '5');
await press('Put it on');
await settle(2000);
check((await head()).includes('995 ft on hand'), `5 ft found go on the shelf (${await head()})`);
const lots = /** @type {string} */ (await textOf('#lots-h'));
const stock = /** @type {string} */ (
	await evaluate(`document.querySelector('.box').textContent.replace(/\\s+/g, ' ')`)
);
check(
	stock.includes('found') && stock.includes('Found') && lots.includes('Received'),
	'the find is a lot of its own, marked found'
);

// Its Adjustments tab: each, why, and what it moved was worth -- the take at
// a tenth of a foot's 0.31 and its share of the tax, 3.10 and 0.2403.
await evaluate(
	`[...document.querySelectorAll('.unav a')].find((a) => a.textContent.trim().startsWith('Adjustments'))?.click()`
);
await settle(2000);
const adjustments = /** @type {string} */ (
	await evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`)
);
check(
	adjustments.includes('Used in the shop') &&
		adjustments.includes('Run to the bench') &&
		adjustments.includes('−10 ft') &&
		adjustments.includes('$3.34') &&
		adjustments.includes('Found') &&
		adjustments.includes('+5 ft'),
	'Adjustments lists each, why, and what it was worth'
);

/** The tab that reads `label`, opened. */
const tab = async (/** @type {string} */ label) => {
	await run(
		(/** @type {string} */ want) =>
			/** @type {HTMLAnchorElement | undefined} */ (
				[...document.querySelectorAll('.unav a')].find((a) =>
					a.textContent?.trim().startsWith(want)
				)
			)?.click(),
		label
	);
	await settle(2000);
};
/** A detail opened by its pencil, given `value`, and saved. */
const change = async (/** @type {string} */ field, /** @type {string} */ value) => {
	await evaluate(`document.querySelector('[data-edit="${field}"]')?.click()`);
	await settle(300);
	await run((/** @type {string} */ v) => {
		const f = /** @type {HTMLInputElement} */ (document.activeElement);
		f.value = v;
		f.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
	await press('Save');
	await settle(2000);
};
const body = async () =>
	/** @type {string} */ (await evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`));

// A COUNT: 990 ft on the shelf where it says 995. Before it is applied, 10 ft
// more are used; applying asks what to keep, and keeping the difference found
// takes 5 ft off the 985 now there.
const cableId = /** @type {string} */ (await evaluate(`location.pathname.split('/')[3]`));
const cablePage = /** @type {string} */ (await evaluate('location.pathname'));
await go('/catalogue/materials');
await press('Count');
await settle(2500);
const countPage = /** @type {string} */ (await evaluate('location.pathname'));
await set(`#c-${cableId}`, '990');
await run(
	(/** @type {string} */ sel) =>
		document.querySelector(sel)?.dispatchEvent(new Event('change', { bubbles: true })),
	`#c-${cableId}`
);
await settle(2500);
const sheet = await textOf('#count-panel-done');
check(
	countPage.startsWith('/catalogue/counts/') && sheet.includes(NAME) && sheet.includes('−5 ft'),
	`a count is started from Materials, and the cable counted 5 ft short (${sheet.slice(0, 160)})`
);
await go(cablePage);
await press('Adjust');
await settle(400);
await set('#a-qty', '10');
await press('Take it off');
await settle(2000);
await go(countPage);
await press('Apply');
await settle(400);
await evaluate(`document.querySelector('dialog[open] [data-go]')?.click()`);
await settle(2000);
const askedKeep = /** @type {string} */ (await textOf('dialog[open]'));
check(
	askedKeep.includes('Moved since it was counted') &&
		askedKeep.includes('counted 990 ft when the shelf said 995 ft; it says 985 ft now'),
	`stock used since it was counted is told, not written over (${askedKeep.slice(0, 200)})`
);
await run(() =>
	/** @type {HTMLInputElement | null} */ (
		document.querySelector('dialog[open] input[name="c-keep"][value="difference"]')
	)?.click()
);
await evaluate(`document.querySelector('dialog[open] [data-go]')?.click()`);
await settle(2500);
const appliedCount = await body();
check(
	!(await dialogOpen()) &&
		appliedCount.includes('What was counted') &&
		appliedCount.includes('−5 ft'),
	'kept as the difference found, the count is applied: 5 ft off'
);
await go(cablePage);
check((await head()).includes('980 ft on hand'), `the shelf is 985 less 5 (${await head()})`);
await tab('Adjustments');
const countedRow = /** @type {string} */ (
	await evaluate(
		`[...document.querySelectorAll('a.box-row')].find((a) => a.textContent.includes('Counted'))?.getAttribute('href') ?? ''`
	)
);
check(countedRow === countPage, 'its Adjustments has the count’s, which opens the count');
await go(cablePage);

// ITS DETAILS: what it is, changed in place, and what it sells at, in a dialog.
await tab('Details');
const details = await body();
check(
	details.includes('Counted in') &&
		details.includes('Fixed once some is received.') &&
		!(await evaluate(`!!document.querySelector('[data-edit="unit_id"]')`)),
	'what it is counted in is fixed, and says so, once some of it is received'
);
await change('brand', 'Southwire');
check((await head()).includes('Southwire'), `its brand is changed in place (${await head()})`);

// Someone else renames it meanwhile: this rename is told so, and Save again puts it over theirs.
const RENAMED = `${NAME}, renamed`;
const theirs = await run(
	async (/** @type {string} */ was) =>
		(
			await fetch(
				location.pathname
					.replace('/catalogue/materials/', '/api/materials/')
					.replace(/\/details$/, ''),
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						fields: { name: `${was}, theirs` },
						version: 1,
						base: { name: was }
					})
				}
			)
		).status,
	NAME
);
await change('name', RENAMED);
const told = /** @type {string} */ (await textOf('.fc-e'));
check(
	theirs === 200 && told.includes('changed name meanwhile'),
	`a rename made meanwhile is told, not written over (${theirs}, ${told})`
);
await press('Save');
await settle(2000);
check(
	(await evaluate(`document.querySelector('h1')?.textContent?.trim()`)) === RENAMED,
	'Save again puts this rename over theirs'
);

// A set price a foot, from today; then back to the markup.
await evaluate(`document.querySelector('[aria-label="Change what it sells at"]')?.click()`);
await settle(400);
await run(() =>
	/** @type {HTMLInputElement | null} */ (
		document.querySelector('dialog[open] input[name="p-by"][value="price"]')
	)?.click()
);
await settle(200);
await set('#p-price', '0.50');
await evaluate(`document.querySelector('dialog[open] [data-go]')?.click()`);
await settle(2000);
check(
	!(await dialogOpen()) && (await head()).includes('sells at $0.50 a ft'),
	`a set price is given from today (${await head()})`
);
await evaluate(`document.querySelector('[aria-label="Change what it sells at"]')?.click()`);
await settle(400);
await run(() =>
	/** @type {HTMLInputElement | null} */ (
		document.querySelector('dialog[open] input[name="p-by"][value="business"]')
	)?.click()
);
await evaluate(`document.querySelector('dialog[open] [data-go]')?.click()`);
await settle(2000);
check(
	!(await head()).includes('$0.50') && (await head()).includes(sells),
	`back to the business's markup, it sells at ${sells} again (${await head()})`
);

// Its History: each save, newest first, who made it.
await tab('History');
const history = await body();
check(
	history.includes('Added') &&
		history.includes('Brand: nothing → “Southwire”') &&
		history.includes(`Name: “${NAME}, theirs” → “${RENAMED}”`) &&
		history.includes('Sells at $0.50 a ft') &&
		history.includes('Sells at its markup again'),
	`History has each change${history.includes('Brand:') ? '' : ` (${history.slice(0, 400)})`}`
);

// Retired: not offered, said on its record and under Retired on Materials,
// and a receipt naming it is refused.
await evaluate(`document.querySelector('button[aria-label^="Actions for"]')?.click()`);
await settle(300);
await run(() =>
	/** @type {HTMLButtonElement | undefined} */ (
		[...document.querySelectorAll('[role="menuitem"]')].find(
			(b) => b.textContent?.trim() === 'Retire'
		)
	)?.click()
);
await settle(400);
await evaluate(`document.querySelector('dialog[open] [data-go]')?.click()`);
await settle(2000);
const retiredPage = await body();
check(
	retiredPage.includes('Not offered for new lines') && (await head()).includes('Retired'),
	'retired, its record says so'
);
const materialId = /** @type {string} */ (await evaluate(`location.pathname.split('/')[3]`));
const refusedReceipt = /** @type {string} */ (
	await run(async (/** @type {string} */ id) => {
		const f = new FormData();
		f.set('received_on', new Date().toISOString().slice(0, 10));
		f.set('tax_paid', '0');
		f.set(
			'items',
			JSON.stringify([{ material_id: id, count: '1', per: '', price: '1.00', price_is: 'each' }])
		);
		const r = await fetch('/catalogue/receipts/new', {
			method: 'POST',
			headers: { 'x-sveltekit-action': 'true' },
			body: f
		});
		return await r.text();
	}, materialId)
);
check(
	refusedReceipt.includes(`${RENAMED} is retired`),
	`a receipt naming it is refused (${refusedReceipt.slice(0, 200)})`
);
await go('/catalogue/materials');
const listed = /** @type {string} */ (
	await evaluate(
		`document.querySelector('[aria-labelledby="retired-h"]')?.textContent.replace(/\\s+/g, ' ') ?? ''`
	)
);
check(listed.includes(RENAMED), 'Materials lists it under Retired');

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
