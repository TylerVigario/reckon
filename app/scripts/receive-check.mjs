#!/usr/bin/env node
/**
 * Proves stock is received in the app: a lot, its costs as the receipt says
 * them, who paid, and the receipt.
 *
 *   node scripts/receive-check.mjs <base-url> <email> <password>
 *
 * A material new to the catalogue is named on the form with the unit it is
 * counted in; a quantity with more places than the unit counts in is refused
 * before anything is sent; what one foot cost and sells at shows as it is
 * typed; and a photo, large as a phone's camera makes them, arrives shrunk. The
 * lot is read back from the material's page, and the receipt from its link.
 *
 * Uses the browser on 9222, as console-check does.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node scripts/receive-check.mjs <base-url> <email> <password>');
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
await go('/catalogue/materials/receive');

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
// The receiving form, not the sign-out form the layout puts first on every page.
const text = () =>
	evaluate(`document.querySelector('form.form').textContent.replace(/\\s+/g, ' ')`);
const submit = () => evaluate(`document.querySelector('form.form button.btn.pri').click()`);

// Something new, counted in feet.
await set('#r-item', '', 'change');
await settle(300);
await set('#r-name', NAME);
await run((/** @type {string} */ unit) => {
	const s = /** @type {HTMLSelectElement} */ (document.querySelector('#r-unit'));
	s.value = [...s.options].find((o) => o.textContent?.trim() === unit)?.value ?? '';
	s.dispatchEvent(new Event('change', { bubbles: true }));
}, 'foot');
await set('#r-from', 'Delta Wholesale');
await set('#r-cost', '310.00');
await set('#r-tax', '24.80');

await set('#r-qty', '147.555');
await submit();
await settle(800);
const refused = /** @type {string} */ (await text());
const stayed =
	(await evaluate('location.pathname')) === '/catalogue/materials/receive' &&
	/At most 2 decimal places in this unit\./.test(refused);
check(
	stayed,
	`a quantity with more places than its unit is refused before it is sent${stayed ? '' : ` (${refused.slice(0, 400)})`}`
);

await set('#r-qty', '1000');
await settle(300);
const bill = /** @type {string} */ (
	(await evaluate(`document.querySelector('.bill')?.textContent.replace(/\\s+/g, ' ') ?? ''`)) ?? ''
);
// A foot at $0.31 sells at the business's markup over it: at 25%, $0.3875.
const markup = Number(/(\d+)% markup/.exec(bill)?.[1] ?? NaN);
const tenThousandths = 31 * (100 + markup);
const sells = `$0.${String(tenThousandths)
	.padStart(4, '0')
	.replace(/0{1,2}$/, '')}`;
const priced =
	bill.includes('$0.31') && bill.includes('$0.0248') && bill.includes(`Sells at ${sells}/ft`);
check(
	priced,
	`what a foot cost and sells at shows as it is typed${priced ? '' : bill ? ` (${bill})` : ', but nothing shows'}`
);

// Paid by the first person on the list.
const payer = await evaluate(`(() => {
	const b = [...document.querySelectorAll('.seg button')][0];
	b?.click();
	return b?.textContent?.trim() ?? '';
})()`);

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
check(/^\/catalogue\/materials\/[0-9a-f-]{36}$/.test(at), 'it is received, and opens its material');
const page = /** @type {string} */ (
	await evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`)
);
check(
	page.includes(NAME) &&
		page.includes('1,000 ft for $310.00, and $24.80 tax') &&
		page.includes(`paid by ${payer}`),
	'the lot reads as its receipt says, and who paid'
);
const receipt = await evaluate(`(async () => {
	const a = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'The receipt');
	if (!a) return null;
	const r = await fetch(a.href);
	return { status: r.status, type: r.headers.get('content-type'), size: (await r.blob()).size };
})()`);
check(
	receipt?.status === 200 && receipt.type === 'image/jpeg' && receipt.size < original,
	`the receipt is kept, shrunk on the phone${receipt ? ` (${Math.round(original / 1024)} KB → ${Math.round(receipt.size / 1024)} KB)` : ', but there is no link to it'}`
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
console.log('\nStock is received, with its costs, who paid and its receipt.');
