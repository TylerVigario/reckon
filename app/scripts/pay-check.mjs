#!/usr/bin/env node
/**
 * Proves pay is recorded when it is paid: a person's owed work, ticked, recorded
 * as a payment with the figure and the rule each came to; the pay report saying
 * they are owed nothing; the trip the payment covered staying as it was paid;
 * and a correction to the payment going on the next one.
 *
 *   node scripts/pay-check.mjs <base-url> <email> <password>
 *
 * Pays Sam on the demo: everything Sam is owed, the trip in the Corolla among
 * it. Runs after offline-check, which changes that trip with no signal.
 *
 * Uses the browser on 9222, as console-check does.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node scripts/pay-check.mjs <base-url> <email> <password>');
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

const tap = (/** @type {string} */ label) =>
	run((/** @type {string} */ text) => {
		const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
		b?.click();
		return !!b;
	}, label);
const page = async () =>
	/** @type {string} */ (await evaluate(`document.querySelector('main')?.innerText ?? ''`));
/** A link whose own text holds `text`: its href. */
const linkTo = (/** @type {string} */ text) =>
	run((/** @type {string} */ want) => {
		const a = [...document.querySelectorAll('a.rec.link')].find((x) =>
			x.textContent?.includes(want)
		);
		return a ? a.getAttribute('href') : null;
	}, text);
const set = (/** @type {string} */ selector, /** @type {string} */ value) =>
	run(
		(/** @type {string} */ sel, /** @type {string} */ v) => {
			const f = /** @type {HTMLInputElement} */ (document.querySelector(sel));
			f.value = v;
			f.dispatchEvent(new Event('input', { bubbles: true }));
		},
		selector,
		value
	);

await go('/reports/pay');
const sams = await linkTo('Sam Ortega');
check(!!sams, 'the pay report lists Sam among who is owed');
await go(sams ?? '/reports/pay');
const owedPage = await page();
const thisPayment = /This payment\s+(\$[\d,]+\.\d\d)/.exec(owedPage)?.[1] ?? '';
check(
	owedPage.includes('Trip in the Corolla') && thisPayment !== '' && thisPayment !== '$0.00',
	`what Sam is owed is ticked, the Corolla's trip among it (${thisPayment})`
);
await set('#p-note', 'Paid by pay-check');
await tap('Record the payment');
await settle(2500);
const paidPath = /** @type {string} */ (await evaluate('location.pathname'));
const paid = await page();
check(
	/^\/reports\/pay\/payments\/[0-9a-f-]{36}$/.test(paidPath) &&
		paid.includes('Paid Sam Ortega') &&
		paid.includes(thisPayment) &&
		paid.includes('as an Employee') &&
		paid.includes('Paid by pay-check'),
	`the payment is recorded, each item with its figure and rule (${paidPath})`
);

await go('/reports/pay');
const samRow = /** @type {string} */ (
	await run(
		() =>
			[...document.querySelectorAll('a.rec.link')]
				.find((x) => x.textContent?.includes('Sam Ortega'))
				?.textContent?.replace(/\s+/g, ' ') ?? ''
	)
);
check(
	samRow.includes('Last paid') && samRow.includes(thisPayment) && samRow.includes('$0.00'),
	`the pay report says Sam is owed nothing now, and when Sam was last paid (${samRow})`
);

await go('/trips');
const corolla = await linkTo('Corolla');
if (corolla) {
	await go(corolla);
	const trip = await page();
	check(
		trip.includes('in a payment for the vehicle, so it stays as it was paid') &&
			!trip.includes('Change this trip'),
		'the trip the payment covered stays as it was paid'
	);
} else failures.push('could not find the Corolla trip on /trips');

// A correction to it goes on the next payment.
await go(sams ?? '/reports/pay');
check((await page()).includes('Nothing owed'), 'Sam is owed nothing');
await tap('Add');
await settle(300);
await set('#c-amount', '1.00');
await set('#c-why', 'Paid a dollar short');
await settle(300);
await tap('Record the payment');
await settle(2500);
const fixed = await page();
check(
	fixed.includes('A correction to') &&
		fixed.includes('Paid a dollar short') &&
		fixed.includes('$1.00'),
	'a correction is recorded on a payment of its own, saying which it corrects'
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
console.log('\nPay is recorded when it is paid, and stands.');
