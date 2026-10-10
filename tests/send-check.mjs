#!/usr/bin/env node
/**
 * Proves an invoice is sent with its link (0028): a draft with lines is sent
 * from its Send screen, which dates it and gives it its link; the invoice then
 * shows what is owed and the link; the link opens the invoice signed out, and
 * nothing else does; a send repeated is the same link; and a draft with nothing
 * on it is not sent.
 *
 *   node tests/send-check.mjs <base-url> <email> <password>
 *
 * Sends the draft lines-check made, so it runs after everything that adds to
 * it. Uses the browser on 9222, as console-check does.
 */
const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node tests/send-check.mjs <base-url> <email> <password>');
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
		const b = [...document.querySelectorAll('button, a.btn')].find(
			(x) => x.textContent?.trim() === text
		);
		/** @type {HTMLElement | undefined} */ (b)?.click();
		return !!b;
	}, label);
const page = async () =>
	/** @type {string} */ (await evaluate(`document.querySelector('main')?.innerText ?? ''`));
/** POSTs from the page, with its session: the status and the body. */
const post = (/** @type {string} */ path, /** @type {unknown} */ body) =>
	run(
		async (/** @type {string} */ p, /** @type {string} */ b) => {
			const r = await fetch(p, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: b
			});
			return { status: r.status, body: await r.json().catch(() => null) };
		},
		path,
		JSON.stringify(body ?? {})
	);
/** A request from outside the app: no session, as a client opening a link. */
const signedOut = (/** @type {string} */ path) =>
	fetch(base + path, {
		redirect: 'manual',
		headers: base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {}
	});

// The draft lines-check made: the one with its jacks.
await go('/invoices');
const draft = /** @type {string | null} */ (
	await run(async () => {
		const links = [...document.querySelectorAll('a[href]')]
			.map((a) => a.getAttribute('href') ?? '')
			.filter((h) => /\/invoices\/[0-9a-f-]{36}$/.test(h));
		for (const h of [...new Set(links)]) {
			const html = await (await fetch(h)).text();
			if (html.includes('Keystone jacks') && /Draft INV-/.test(html))
				return new URL(h, location.href).pathname;
		}
		return null;
	})
);
check(!!draft, `the draft with the jacks is among the invoices (${draft})`);
const draftId = draft?.split('/').pop() ?? '';

await go(draft ?? '/invoices');
await tap('Send');
await settle(2500);
const sendPath = /** @type {string} */ (await evaluate('location.pathname'));
const sendPage = await page();
check(
	sendPath === `${draft}/send` && /How it reaches them/i.test(sendPage) && /net \d+/.test(sendPage),
	`Send opens the draft's Send screen: what it asks, when it is dated and due (${sendPath})`
);

await tap('Copy the link');
await settle(3000);
const sentPath = /** @type {string} */ (await evaluate('location.pathname'));
const sent = await page();
const shown = /** @type {string} */ (
	await evaluate(`document.querySelector('.link-text')?.textContent?.trim() ?? ''`)
);
const token = /\/invoice\/([A-Za-z0-9_-]{20,64})$/.exec(shown)?.[1] ?? '';
check(
	sentPath === draft &&
		/the client's link/i.test(sent) &&
		/(^|\n)sent(\n|$)/i.test(sent) &&
		/(^|\n)owed(\n|$)/i.test(sent) &&
		token !== '',
	`it is sent: the invoice shows what is owed and the client's link (${line(shown)})`
);

const opened = await signedOut(`/invoice/${token}`);
const client = await opened.text();
check(
	opened.status === 200 &&
		/Invoice INV-\d+/.test(client) &&
		client.includes('Balance due') &&
		client.includes('Keystone jacks') &&
		!client.includes('class="rail"'),
	`the link opens the invoice signed out, without the app around it (${opened.status})`
);
check((opened.headers.get('cache-control') ?? '').includes('no-store'), 'and no cache keeps it');
const guessed = await signedOut(`/invoice/${'A'.repeat(43)}`);
check(guessed.status === 404, `a link that is not one opens nothing (${guessed.status})`);
const list = await signedOut('/invoices');
check(
	list.status === 303 && (list.headers.get('location') ?? '').startsWith('/login'),
	`the invoices themselves still ask to sign in (${list.status})`
);
const inner = await signedOut(`/invoice/${token}/elsewhere`);
check(inner.status === 303, `nor does the link open anything under it (${inner.status})`);

const again = await post(`/api/invoices/${draftId}/send`, {});
check(
	again.status === 200 && String(again.body?.link ?? '').endsWith(`/invoice/${token}`),
	`sent again, it answers with the same link (${again.status})`
);
await go(`${draft}/send`);
check(
	(await evaluate('location.pathname')) === draft,
	'its Send screen, once it is sent, opens the invoice'
);

const missing = await post(`/api/invoices/${crypto.randomUUID()}/send`, {});
check(missing.status === 404, `no such invoice is not sent (${missing.status})`);
// A draft with nothing on it, started for one of the clients New draft offers.
const entityId = /** @type {string} */ (
	await run(async () => {
		const html = await (await fetch('/invoices/new')).text();
		return /<select id="n-client"[\s\S]*?<option value="([0-9a-f-]{36})"/.exec(html)?.[1] ?? '';
	})
);
if (entityId) {
	const empty = await post('/api/drafts', {
		client_uuid: crypto.randomUUID(),
		entity_id: entityId
	});
	const refused = await post(`/api/invoices/${empty.body?.id}/send`, {});
	check(
		refused.status === 400 && /nothing on it/i.test(JSON.stringify(refused.body)),
		`a draft with nothing on it is not sent (${refused.status})`
	);
} else failures.push('could not find a client on New draft');

check(
	uncaught.length === 0,
	`nothing is left uncaught${uncaught.length ? `: ${[...new Set(uncaught)].join(' | ')}` : ''}`
);

ws.close();
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log('\nAn invoice is sent with its link, and the link opens it alone.');
