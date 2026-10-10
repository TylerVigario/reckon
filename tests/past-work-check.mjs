#!/usr/bin/env node
/**
 * Proves the past-work form takes a start and one other, and fills in the third.
 *
 *   node tests/past-work-check.mjs <base-url> <email> <password>
 *
 * Past work is a start, a length and an end (#lib/work-times): a start and a
 * length give the end, a start and an end give the length, and after that a
 * changed start moves the end and keeps the length, a changed length moves the
 * end, and a changed end changes the length. An end earlier than the start is
 * the next day. The arithmetic is unit-tested; this is the form doing it, as
 * the fields are typed in, and the entry it saves.
 *
 * Uses the browser on 9222, as console-check does. The day is fixed, 16
 * September 2026, a day no zone changes its clocks on either side of, so the
 * lengths are the same in whatever zone the person is in. Reads the saved
 * entry back through HTTP, from All entries for that month.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node tests/past-work-check.mjs <base-url> <email> <password>');
	process.exit(2);
}

const DAY = '2026-09-16';
/** On the entry, so it can be found again among the month's. */
const NOTE = 'Entered by past-work-check';

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

/** A field typed into, as a person does: its value, then the event the page listens for. */
const type = (/** @type {string} */ field, /** @type {string} */ value) =>
	run(
		(/** @type {string} */ selector, /** @type {string} */ typed) => {
			const f = /** @type {HTMLInputElement} */ (document.querySelector(selector));
			f.value = typed;
			f.dispatchEvent(new Event('input', { bubbles: true }));
		},
		field,
		value
	);
/** @returns {Promise<{ start: string; took: string; end: string; nextDay: boolean }>} */
const fields = () =>
	evaluate(`({
		start: document.querySelector('#m-start').value,
		took: document.querySelector('#m-length').value,
		end: document.querySelector('#m-end').value,
		nextDay: [...document.querySelectorAll('.hint')].some((h) => h.textContent.trim() === 'the next day')
	})`);
const shows = async (
	/** @type {string} */ what,
	/** @type {Partial<Awaited<ReturnType<typeof fields>>>} */ want
) => {
	await settle(200);
	const got = await fields();
	const pass = Object.entries(want).every(
		([k, v]) => got[/** @type {keyof typeof got} */ (k)] === v
	);
	check(pass, `${what}${pass ? '' : ` (${JSON.stringify(got)})`}`);
};

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
await go('/timesheet/manual');

await type('#m-day', DAY);
await type('#m-start', '09:00');
await shows('a start alone waits for one other', { start: '09:00', took: '', end: '' });
await type('#m-length', '2:40');
await shows('a start and a length give the end', { took: '2:40', end: '11:40' });
await type('#m-end', '12:10');
await shows('a changed end changes the length', { took: '3:10', end: '12:10' });
await type('#m-start', '08:00');
await shows('a changed start moves the end and keeps the length', {
	start: '08:00',
	took: '3:10',
	end: '11:10'
});
await type('#m-end', '01:00');
await shows('an end earlier than the start is the next day', {
	took: '17:00',
	end: '01:00',
	nextDay: true
});
await type('#m-length', '2');
await shows('a changed length moves the end', { took: '2', end: '10:00', nextDay: false });

// Billed to the first client, with a note to find it by, and saved.
await evaluate(`(() => {
	const s = document.querySelector('#m-entity');
	s.value = [...s.options].find((o) => o.value)?.value ?? '';
	s.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await type('#m-note', NOTE);
await evaluate(
	`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save entry')?.click()`
);
await settle(3000);
check((await evaluate('location.pathname')) === '/timesheet', 'it saves, and goes back to Time');

// What the server kept: the row with the note, on All entries for September.
await go(`/timesheet/all?month=${DAY.slice(0, 7)}`);
// Every row's text, and the note looked for here rather than written into code
// the page runs.
const rows = /** @type {string[]} */ (
	(await evaluate(
		`[...document.querySelectorAll('.rec')].map((r) => r.textContent.replace(/\\s+/g, ' '))`
	)) ?? []
);
const row = rows.find((r) => r.includes(NOTE)) ?? '';
check(
	/\b0?8:00\b/.test(row) && /\b10:00\b/.test(row) && /\b2[.,]0000\b/.test(row),
	`it is kept as 8:00 to 10:00, two hours${row ? '' : ', but no row has its note'}`
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
console.log('\nPast work: a start and one other, and the third follows.');
