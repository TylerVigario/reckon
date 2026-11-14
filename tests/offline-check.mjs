#!/usr/bin/env node
/**
 * Proves the installed app works without a signal.
 *
 *   node tests/offline-check.mjs <base-url> <email> online
 *   (stop the server)
 *   node tests/offline-check.mjs <base-url> <email> offline
 *   (start it again)
 *   node tests/offline-check.mjs <base-url> <email> back
 *
 * WHY THREE RUNS. Offline is the server being out of reach, so the server is
 * actually stopped between them, rather than the page being told it is offline:
 * the service worker fetches on its own, and a flag set on the page does not
 * reach it. The browser stays up throughout -- the same one on 9222 that
 * console-check uses -- so the worker, its caches and the capture queue carry
 * from one run to the next, as they do on a phone.
 *
 *   online   signs in, waits for the worker to keep the offline screens -- the
 *            invoices list and each draft among them -- and asks Chrome
 *            whether the app is installable.
 *   offline  opens each offline screen from a cold load; confirms a screen that
 *            needs the network says so instead; starts a timer and stops it,
 *            which leaves an entry in the queue. Beside it goes a copy naming a
 *            service that does not exist -- what an entry recorded offline
 *            looks like once someone deletes its service meanwhile. Then opens
 *            the invoices list and the demo's draft, each saying how old it is,
 *            and adds a permit paid for the client, with its receipt: it waits
 *            on the phone, shown on the draft and in its total. Beside it goes
 *            a line drawing more raceway than the shelf has. Then starts a new
 *            draft for another client, which waits on the phone too, and adds
 *            an equipment hire to it there. Then, on lines-check's draft for
 *            Harbor Light Dental, changes the jacks' description and cost, and
 *            the permit's description: both wait on the phone. Then records a
 *            trip to Harbor Light's office and Valley Oak's clinic, each drive
 *            as last driven, and changes Sam's trip today: both wait on the
 *            phone, on the trips list.
 *   (between, scripts/offline-meanwhile.sql: INV-0212 goes out, and Sam
 *            changes the jacks' cost and supplier and takes the permit off)
 *   back     opens a page, which posts the queue. The good entry goes; the other
 *            is refused, and must be kept, shown with the server's reason,
 *            open to be fixed, and gone only when discarded by hand. INV-0212
 *            went out meanwhile, so the permit starts a new draft for the
 *            client, with its receipt, and both say so; the raceway is refused
 *            and kept the same way, on INV-0212. The draft started on the phone
 *            arrives numbered, with its hire. The jacks' description and
 *            supplier merge, and their cost -- changed in two places -- is
 *            picked from every value it has held; the permit, taken off
 *            meanwhile, is put back with its change. The trip arrives as it was
 *            recorded, its legs worked out on arrival, and Sam's has the change.
 *            Then signs out, which must empty the cache the worker kept.
 *
 *   back, with `other` -- someone else's email -- first has them sign in on the
 *            same phone before `email` is back: none of what was recorded
 *            offline is shown to them or sent under their session (#lib/owner).
 *            A timer of theirs keeps running through signing out, which says so
 *            first, and is never shown to `email` or stopped by them.
 */
import { signIn } from './passkeys.mjs';
const [, , base = 'http://127.0.0.1:5181', email, phase, other] = process.argv;
if (!['online', 'offline', 'back'].includes(phase ?? '')) {
	console.error('usage: node tests/offline-check.mjs <base-url> <email> online|offline|back');
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
/**
 * Whatever the page throws and nothing catches. Without a connection is where
 * a promise nobody handles is likeliest to reject -- every fetch fails -- and
 * the screen can look right while one does.
 * @type {string[]}
 */
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
 * source is this file's own; nothing is written into it, so no value -- what a
 * page said, read back -- can become code the page runs.
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
const settle = (ms = 1800) => new Promise((r) => setTimeout(r, ms));

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
	await settle(2000);
};
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
// Over plain http the browser says what a TLS proxy would (see console-check).
if (base.startsWith('http:'))
	await send('Network.setExtraHTTPHeaders', { headers: { 'x-forwarded-proto': 'http' } });
await send('Emulation.setDeviceMetricsOverride', {
	width: 412,
	height: 915,
	deviceScaleFactor: 2,
	mobile: true
});

/** @type {string[]} */
const failures = [];
const ok = (/** @type {string} */ what) => console.log(`  ✓ ${line(what)}`);
const check = (/** @type {boolean} */ pass, /** @type {string} */ what) =>
	pass ? ok(what) : failures.push(what);

const heading = () => evaluate(`document.querySelector('h1')?.textContent?.trim() ?? ''`);
/** The line under the title: whose a draft is. */
const subtitle = () => evaluate(`document.querySelector('.top .sub')?.textContent?.trim() ?? ''`);
const kept = () =>
	evaluate(`(async () => {
		const name = (await caches.keys()).find((k) => k.startsWith('pages-'));
		return name ? (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname) : [];
	})()`);
const stored = (/** @type {string} */ key) =>
	evaluate(
		`(() => { try { return JSON.parse(localStorage.getItem('${key}') ?? '[]').length } catch { return -1 } })()`
	);
/**
 * Runs `body` against the capture queue's store, in the page, and returns what
 * it resolves. The same database and schema the app opens (#lib/queue.ts).
 */
const inQueue = (/** @type {string} */ body) =>
	evaluate(`new Promise((resolve) => {
		const req = indexedDB.open('reckon', 7);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('queue'))
				db.createObjectStore('queue', { keyPath: 'entry.client_uuid' });
			if (!db.objectStoreNames.contains('lines'))
				db.createObjectStore('lines', { keyPath: 'line.client_uuid' });
			if (!db.objectStoreNames.contains('drafts'))
				db.createObjectStore('drafts', { keyPath: 'draft.client_uuid' });
			if (!db.objectStoreNames.contains('changes'))
				db.createObjectStore('changes', { keyPath: 'change.line_id' });
			if (!db.objectStoreNames.contains('trips'))
				db.createObjectStore('trips', { keyPath: 'trip.key' });
			if (!db.objectStoreNames.contains('time_changes'))
				db.createObjectStore('time_changes', { keyPath: 'change.entry_id' });
			for (const [store, keyPath] of [
				['receipts', 'receipt.client_uuid'],
				['adjustments', 'adjust.client_uuid'],
				['counts', 'count.client_uuid'],
				['counted', 'counted.key']
			])
				if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
		};
		req.onerror = () => resolve(null);
		req.onsuccess = () => {
			const db = req.result;
			const done = (v) => { db.close(); resolve(v); };
			${body}
		};
	})`);
/** @returns {Promise<{ id: string, refused: string | null }[] | null>} */
const queued = () =>
	inQueue(`const all = db.transaction('queue').objectStore('queue').getAll();
		all.onsuccess = () =>
			done(all.result.map((q) => ({ id: q.entry.client_uuid, refused: q.refused?.detail ?? null })));
		all.onerror = () => done(null);`);
/** @returns {Promise<{ id: string, refused: string | null, description: string }[] | null>} */
const linesQueued = () =>
	inQueue(`const all = db.transaction('lines').objectStore('lines').getAll();
		all.onsuccess = () =>
			done(all.result.map((q) => ({
				id: q.line.client_uuid,
				refused: q.refused?.detail ?? null,
				description: q.line.shown.description
			})));
		all.onerror = () => done(null);`);
/** @returns {Promise<{ id: string, act: string, refused: string | null, what: string | null }[] | null>} */
const timeChangesQueued = () =>
	inQueue(`const all = db.transaction('time_changes').objectStore('time_changes').getAll();
		all.onsuccess = () =>
			done(all.result.map((q) => ({
				id: q.change.entry_id,
				act: q.change.act,
				refused: q.refused?.detail ?? null,
				what: q.refused?.conflict?.what ?? null
			})));
		all.onerror = () => done(null);`);
const click = (/** @type {string} */ text) =>
	evaluate(`(() => {
		const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
		if (!b) return false;
		b.click();
		return true;
	})()`);

const OFFLINE = ['/', '/timesheet', '/timesheet/start', '/timesheet/manual'];
/** The demo's draft, INV-0212 for a homeowner, and an invoice that has gone out. */
const DRAFT = '/invoices/6f444d02-b482-4506-98fe-ee23f45d26c5';
const SENT = '/invoices/2858d54a-2fa4-4a88-b35e-b9f0a1fbe27a';
/** The demo's raceway, of which 60 ft is on the shelf. */
const RACEWAY = 'b144a78b-750a-4bd2-a84e-7d1551328565';
const LISTED = [
	'/invoices',
	'/invoices/new',
	'/invoices/on-phone',
	'/invoices/on-phone/add',
	DRAFT,
	`${DRAFT}/add`
];
/** The client a draft is started for on the phone, and where its uuid is kept between runs. */
const STARTED_FOR = 'Valley Oak Veterinary';
const STARTED = 'offline-check.draft';
/** Where the lines changed with no signal are, kept between runs. */
const CHANGED = 'offline-check.changed';
/** Where the trip recorded and the trip changed with no signal are, kept between runs. */
const TRIPS = 'offline-check.trips';
/** Where the time entries changed and removed with no signal are, kept between runs. */
const ENTRIES = 'offline-check.entries';
/** Where the stock received, adjusted and counted with no signal is kept between runs. */
const STOCK = 'offline-check.stock';
/** Something new received with no signal, and how many came. */
const TIES = 'Cable ties · 8 in';
/** How much stock work waits on the phone, in all four of its stores. */
const stockQueued = () =>
	inQueue(`const stores = ['receipts', 'adjustments', 'counts', 'counted'];
		const t = db.transaction(stores);
		let n = 0;
		for (const s of stores) t.objectStore(s).count().onsuccess = (e) => (n += e.target.result);
		t.oncomplete = () => done(n);
		t.onerror = () => done(null);`);
/** Where Avery's own trip, changed with no signal, is kept between runs. */
const OWN_TRIP = 'offline-check.own-trip';
/** Sam's drive today, in the demo: someone else's, so never kept on Avery's phone. */
const SAMS_TRIP = '/trips/d1ecd94f-1c64-409e-89fd-d6f6da437a7c';
/** The Tacoma, Avery's own. */
const TACOMA = '019a0001-0000-7000-8000-000000000002';
/** Avery, whose entries they are; and the demo's field service, at Pinecrest's suite. */
const AVERY = 'c41b2fab-5b71-4954-bb86-1bc803daf7ee';
const FIELD_SERVICE = '2d15bc02-d08e-4242-860c-5d461bf2b1c2';
const PINECREST = 'adaf8510-48a7-4ce1-a78f-6f7eab7ea29e';
const SUITE = '4c42978a-ace1-4a79-a7f0-0d9e7efed2da';
/** A select set to the option that reads `label`, as a person picks it. */
const choose = (/** @type {string} */ selector, /** @type {string} */ label) =>
	run(
		(/** @type {string} */ sel, /** @type {string} */ want) => {
			const s = /** @type {HTMLSelectElement} */ (document.querySelector(sel));
			s.value = [...s.options].find((o) => o.textContent?.trim() === want)?.value ?? '';
			s.dispatchEvent(new Event('change', { bubbles: true }));
		},
		selector,
		label
	);
const typeIn = (/** @type {string} */ selector, /** @type {string} */ value) =>
	run(
		(/** @type {string} */ sel, /** @type {string} */ v) => {
			const f = /** @type {HTMLInputElement} */ (document.querySelector(sel));
			f.value = v;
			f.dispatchEvent(new Event('input', { bubbles: true }));
		},
		selector,
		value
	);
/** The draft's line that says `name`: its own screen. */
const lineHref = (/** @type {string} */ name) =>
	run((/** @type {string} */ text) => {
		const a = [...document.querySelectorAll('a.rec.link')].find(
			(x) => x.querySelector('.rec-t')?.textContent?.trim() === text
		);
		return a ? a.getAttribute('href') : null;
	}, name);
const banner = () =>
	evaluate(`document.querySelector('.offline')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`);
const text = () => evaluate(`document.body.textContent.replace(/\\s+/g, ' ')`);

if (phase === 'online') {
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
	await go('/');

	// Three entries Avery entered yesterday, which the phone keeps to change with
	// no signal: two to change, one to remove.
	const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
	const made = /** @type {(string | null)[]} */ (
		await run(
			async (/** @type {Record<string, unknown>[]} */ entries) => {
				const ids = [];
				for (const e of entries) {
					const r = await fetch('/api/time', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ ...e, client_uuid: crypto.randomUUID() })
					});
					ids.push(r.ok ? (await r.json()).id : null);
				}
				return ids;
			},
			[
				{ note: 'Patched the front desk', minutes: 60 },
				{ note: 'Checked the wiring closet', minutes: 30 },
				{ note: 'Labelled the patch panel', minutes: 45 }
			].map((e) => ({
				...e,
				worked_on: yesterday,
				crew: 'one',
				worked_by: AVERY,
				entity_id: PINECREST,
				site_id: SUITE,
				service_id: FIELD_SERVICE,
				billable: true
			}))
		)
	);
	const [toChange, toRemove, toAddAgain] = made;
	check(
		!!toChange && !!toRemove && !!toAddAgain,
		'Avery enters three entries to change with no signal'
	);
	await run(
		(/** @type {string} */ key, /** @type {string} */ value) => localStorage.setItem(key, value),
		ENTRIES,
		JSON.stringify({ toChange, toRemove, toAddAgain, month: yesterday.slice(0, 7) })
	);
	// And a trip Avery drove yesterday, not yet billed: hers to put right on the
	// road. Someone else's is not kept on her phone, Full or not.
	const ownTrip = /** @type {string | null} */ (
		await run(
			async (/** @type {Record<string, unknown>} */ trip) => {
				const r = await fetch('/api/trips', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...trip, client_uuid: crypto.randomUUID() })
				});
				return r.ok ? (await r.json()).id : null;
			},
			{
				travelled_on: yesterday,
				driven_by: AVERY,
				vehicle_id: TACOMA,
				stops: [
					{ address: 'Offline check yard', clients: [{ entity_id: PINECREST, asked_there: false }] }
				],
				drives: [{ miles: '9.0' }, { miles: '9.0' }]
			}
		)
	);
	check(!!ownTrip, 'Avery records a trip of her own, to put right with no signal');
	await run(
		(/** @type {string} */ key, /** @type {string} */ value) => localStorage.setItem(key, value),
		OWN_TRIP,
		`/trips/${ownTrip}`
	);
	const entryScreens = [
		'/timesheet/all',
		`/timesheet/${toChange}`,
		`/timesheet/${toRemove}`,
		`/timesheet/${toAddAgain}`,
		`/trips/${ownTrip}`,
		`/trips/${ownTrip}/change`
	];
	await go('/');

	// The worker installs on the first load, then fetches the offline screens
	// when the page asks it to; a fresh load makes sure it is the one asked.
	/** @type {string[]} */
	let have = [];
	// Every screen the server listed, as well as the ones named here: the worker
	// keeps a draft's line screens last, and the server goes before they are in.
	const listed = () =>
		evaluate(`(async () => {
			const name = (await caches.keys()).find((k) => k.startsWith('pages-'));
			const list = name ? await (await caches.open(name)).match('/api/offline') : undefined;
			return list ? (await list.json()).screens : [];
		})()`);
	// A screen listed with a query is kept in its own place (src/service-worker).
	const everyScreen = (/** @type {string[]} */ h, /** @type {string[]} */ more) =>
		[...OFFLINE, ...LISTED, ...entryScreens, ...more.map((p) => p.split('?')[0])].every(
			(p) => h.includes(p) && h.includes(`${p === '/' ? '' : p}/__data.json`)
		);
	/** @type {string[]} */
	let screens = [];
	for (let i = 0; i < 30 && !everyScreen(have, screens); i++) {
		if (i === 4) await go('/');
		await settle(1000);
		have = (await kept()) ?? [];
		screens = (await listed()) ?? [];
	}
	check(
		everyScreen(have, screens) && screens.some((p) => p.includes('/lines/')),
		`the worker keeps the offline screens and their data, the drafts and their lines among them (${have.length} kept)`
	);
	check(!have.includes(SENT), 'it keeps no invoice that has gone out');
	check(
		entryScreens.every((p) => have.includes(p) && have.includes(`${p}/__data.json`)),
		'it keeps the entries Avery entered and the trip she drove, to change with no signal, and All entries with them'
	);
	check(
		!have.includes(SAMS_TRIP) && !(screens ?? []).includes(SAMS_TRIP),
		'it keeps no trip of anyone else’s, though Avery has Full'
	);
	/** What the worker kept under `path`, as text. */
	const keptAt = async (/** @type {string} */ path) =>
		/** @type {string} */ (
			await run(async (/** @type {string} */ at) => {
				const name = (await caches.keys()).find((k) => k.startsWith('pages-'));
				const hit = name ? await (await caches.open(name)).match(at) : undefined;
				return hit ? await hit.text() : '';
			}, path)
		);
	const allPage = await keptAt('/timesheet/all');
	const allData = await keptAt('/timesheet/all/__data.json');
	check(
		allPage.includes('Yours, this week and last') &&
			[allPage, allData].every(
				(t) => t.includes(String(toChange)) && !t.includes('Replaced the front desk switch')
			),
		'All entries is kept as a copy of its own: Avery’s entries alone, never everyone’s'
	);

	// EVERY SCREEN KEPT IS CUT TO WHAT IS DONE THERE (#lib/offline-copy), page
	// and data alike: nothing of what the business is owed, holds or has not
	// billed, what anything is worth, or anyone else's work.
	const today = await keptAt('/');
	const todayData = await keptAt('/__data.json');
	check(
		today.includes('What is owed, ready to send and not yet billed needs a connection.') &&
			!/Owed to|Sales tax held|Unbilled work/.test(today) &&
			!/tax_held|owed_count|last_paid/.test(todayData) &&
			today.includes('Your work today'),
		'Today is kept as Avery’s own day: no figure of what is owed, held or unbilled'
	);
	const time = await keptAt('/timesheet');
	check(
		time.includes('Everyone else’s work today needs a connection.'),
		'Time is kept with Avery’s work alone'
	);
	const invoices = await keptAt('/invoices');
	const invoicesData = await keptAt('/invoices/__data.json');
	check(
		invoices.includes('needs a connection') &&
			invoices.includes('Not sent') &&
			!/Out, unpaid|Overdue|Paid, recently/.test(invoices) &&
			!/overdueCount|drafted/.test(invoicesData),
		'Invoices is kept as the drafts alone, with nothing they come to'
	);
	const trips = await keptAt('/trips');
	const tripsData = await keptAt('/trips/__data.json');
	check(
		trips.includes('need a connection') &&
			!trips.includes('Sam Ortega') &&
			!tripsData.includes('Sam Ortega') &&
			!/\$\d/.test(trips),
		'Trips is kept as Avery’s own, with nothing they bill'
	);
	const trip = await keptAt(`/trips/${ownTrip}`);
	check(
		trip.includes('needs a connection') &&
			!/Billed|Paid for the vehicle|Not over-billed|\$\d/.test(trip),
		'her trip is kept as the drive, with nothing it bills or pays'
	);

	const materials = await keptAt('/catalogue/materials');
	const materialsData = await keptAt('/catalogue/materials/__data.json');
	check(
		materials.includes('Fibre patch lead') &&
			!/\$\d/.test(materials) &&
			!/"ex_tax":"\d|"price":"\d/.test(materialsData) &&
			have.includes('/catalogue/receipts/new') &&
			have.includes('/catalogue/counts/on-phone'),
		'Materials, Receive and a count are kept, the stock with quantities alone'
	);

	const install = await send('Page.getInstallabilityErrors');
	const errors = install.result?.installabilityErrors ?? [];
	check(
		errors.length === 0,
		`Chrome finds it installable${errors.length ? `: ${errors.map((/** @type {{ errorId: string }} */ e) => e.errorId).join(', ')}` : ''}`
	);
	const manifest = await send('Page.getAppManifest');
	const parsed = JSON.parse(manifest.result?.data || '{}');
	check(
		(manifest.result?.errors ?? []).length === 0 &&
			!!parsed.name &&
			(parsed.icons ?? []).length > 0,
		`the manifest parses, named "${parsed.name ?? ''}", with ${(parsed.icons ?? []).length} icon(s)`
	);
	check((await queued())?.length === 0, 'the capture queue starts empty');
}

if (phase === 'offline') {
	for (const path of OFFLINE) {
		await go(path);
		const h = await heading();
		check(h !== '' && h !== 'No connection', `${path} opens with no server, as "${h}"`);
	}
	await go(SENT);
	check(
		(await heading()) === 'No connection',
		'an invoice that has gone out says it needs a connection'
	);
	await go('/reports');
	check((await heading()) === 'No connection', '/reports says it needs a connection');

	// A timer, started and stopped with no server: the whole of capturing time.
	await go('/timesheet/start');
	await evaluate(`(() => {
		const s = document.querySelector('#s-service');
		s.value = [...s.options].find((o) => o.value)?.value ?? '';
		s.dispatchEvent(new Event('change', { bubbles: true }));
		const team = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Team');
		team?.click();
		const bill = document.querySelector('button.tog.on');
		bill?.click();
	})()`);
	await settle(300);
	check(await click('Start the clock'), 'the timer starts');
	await settle(1500);
	check((await stored('reckon.running')) === 1, 'it is running, on the phone');

	// Set going late: its start moved back an hour, with no signal, as on a
	// jobsite. The time box opens on when it started, to the minute.
	const startOf = () =>
		evaluate(`JSON.parse(localStorage.getItem('reckon.running'))[0].started_at`);
	const was = await startOf();
	await evaluate(`document.querySelector('button.since')?.click()`);
	await settle(300);
	await evaluate(`(() => {
		const f = document.querySelector('.move input');
		const [h, m] = f.value.split(':').map(Number);
		const back = (h * 60 + m + 1440 - 60) % 1440;
		f.value = String(Math.floor(back / 60)).padStart(2, '0') + ':' + String(back % 60).padStart(2, '0');
		f.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	check(await click('Set'), 'its start can be changed');
	await settle(300);
	const moved = await startOf();
	const back = was - moved;
	check(
		back > 59 * 60_000 && back <= 61 * 60_000,
		`it moves back an hour, still running (${Math.round(back / 60_000)} minutes)`
	);

	check(await click('Stop'), 'the timer stops');
	await settle(1500);
	check(
		(await stored('reckon.running')) === 0 && (await queued())?.length === 1,
		'its entry waits in the queue'
	);
	const startedAt =
		await inQueue(`const all = db.transaction('queue').objectStore('queue').getAll();
		all.onsuccess = () => done(all.result[0]?.entry.started_at ?? null);
		all.onerror = () => done(null);`);
	check(
		typeof startedAt === 'string' && Date.parse(startedAt) === moved,
		'its entry starts where the start was moved to'
	);

	// The same entry again, but naming a service that is not there: an entry
	// recorded offline whose service someone deleted before the phone got back.
	// It ran 80 minutes, so its length can be read back as 1:20.
	const planted =
		await inQueue(`const store = db.transaction('queue', 'readwrite').objectStore('queue');
		const all = store.getAll();
		all.onsuccess = () => {
			const q = all.result[0];
			store.put({
				entry: {
					...q.entry,
					client_uuid: crypto.randomUUID(),
					service_id: crypto.randomUUID(),
					ended_at: new Date(Date.parse(q.entry.started_at) + 80 * 60_000).toISOString()
				},
				queued_at: q.queued_at + 1,
				owner: q.owner
			});
			store.transaction.oncomplete = () => done(true);
		};
		all.onerror = () => done(false);`);
	check(
		planted === true && (await queued())?.length === 2,
		'one naming a deleted service waits beside it'
	);

	// The invoices and the draft, from the copies the worker kept, saying so.
	await go('/invoices');
	const listSays = await banner();
	check(
		(await heading()).startsWith('Invoices') &&
			/^● Offline · as of .+ · 2 changes waiting to send$/.test(listSays),
		`/invoices opens with no server, saying how old it is (${listSays})`
	);
	await go(DRAFT);
	const before = await evaluate(
		`[...document.querySelectorAll('.rec.tot')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())[0] ?? ''`
	);
	check(
		(await heading()).startsWith('Draft INV-0212') && /Offline · as of/.test(await banner()),
		`the draft opens with no server, saying how old it is (${before})`
	);

	// A permit paid for the client, with its receipt: added with no signal.
	await evaluate(
		`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Add a line')?.click()`
	);
	await settle(2000);
	check((await heading()).startsWith('Add a line'), 'Add a line opens with no server');
	await click('Paid for them');
	await settle(200);
	await evaluate(`(() => {
		const set = (id, v) => {
			const f = document.querySelector(id);
			f.value = v;
			f.dispatchEvent(new Event('input', { bubbles: true }));
		};
		set('#l-desc', 'Low-voltage permit');
		set('#l-from', 'City of Woodland');
		set('#l-cost', '35.00');
	})()`);
	await evaluate(`(async () => {
		const c = document.createElement('canvas');
		c.width = 800;
		c.height = 1000;
		c.getContext('2d').fillRect(100, 100, 300, 200);
		const blob = await new Promise((done) => c.toBlob(done, 'image/png'));
		const input = document.querySelector('#l-receipt');
		const t = new DataTransfer();
		t.items.add(new File([blob], 'permit.png', { type: 'image/png' }));
		input.files = t.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	})()`);
	await settle(300);
	check(await click('Add the line'), 'the line is added');
	await settle(3000);
	const page = /** @type {string} */ (await text());
	const lines = (await linesQueued()) ?? [];
	check(
		lines.length === 1 && (await evaluate('location.pathname')) === DRAFT,
		'it waits on the phone, and the draft opens'
	);
	check(
		/Low-voltage permit.*Receipt.*On this phone.*\$35\.00/.test(page),
		'the draft shows it, with its receipt, as on this phone'
	);
	check(
		page.includes('Due $189.38') && /3 changes waiting to send/.test(await banner()),
		`its total takes it in: $154.38 and $35.00 (${page.match(/Due \$[\d,.]+/g)?.join(', ') ?? ''})`
	);

	// Raceway the shelf will not have when it arrives: 1,000 ft, of 60 or less.
	const short =
		await inQueue(`const store = db.transaction('lines', 'readwrite').objectStore('lines');
		store.put({
			line: {
				client_uuid: crypto.randomUUID(),
				invoice_id: ${JSON.stringify(DRAFT.split('/').pop())},
				fields: {
					kind: 'material',
					material_id: ${JSON.stringify(RACEWAY)},
					qty: '1000',
					description: 'Raceway · Surface · 3/4 in',
					site_id: ''
				},
				receipt: null,
				shown: {
					kind: 'material',
					description: 'Raceway · Surface · 3/4 in',
					detail: 'From stock',
					qty: '1000',
					unit: 'foot',
					unit_price: '1.0625',
					amount: '1062.50',
					taxable: false,
					tax_rate_pct: '0'
				}
			},
			queued_at: Date.now()
		});
		store.transaction.oncomplete = () => done(true);`);
	check(
		short === true && (await linesQueued())?.length === 2,
		'more raceway than is left waits beside it'
	);

	// A draft for another client, started with no signal, and a hire added to it.
	await go('/invoices/new');
	check((await heading()).startsWith('New draft'), 'New draft opens with no server');
	await evaluate(`(() => {
		const s = document.querySelector('#n-client');
		s.value = [...s.options].find((o) => o.textContent.trim() === ${JSON.stringify(STARTED_FOR)})?.value ?? '';
		s.dispatchEvent(new Event('change', { bubbles: true }));
	})()`);
	check(await click('Start the draft'), 'the draft is started');
	await settle(5500);
	const landed = /** @type {string} */ (await evaluate('location.pathname + location.search'));
	const uuid = new URL(landed, base).searchParams.get('draft') ?? '';
	await run(
		(/** @type {string} */ key, /** @type {string} */ value) => localStorage.setItem(key, value),
		STARTED,
		uuid
	);
	check(
		landed.startsWith('/invoices/on-phone?draft=') &&
			/Started on this phone\. It takes its number when it reaches the server\./.test(await text()),
		'it waits on the phone, to take its number when it arrives'
	);
	await evaluate(
		`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Add a line')?.click()`
	);
	await settle(2000);
	check(
		(await heading()).startsWith('Add a line') && (await subtitle()).includes(STARTED_FOR),
		'Add a line opens for it with no server'
	);
	await click('Paid for them');
	await settle(200);
	await evaluate(`(() => {
		const set = (id, v) => {
			const f = document.querySelector(id);
			f.value = v;
			f.dispatchEvent(new Event('input', { bubbles: true }));
		};
		set('#l-desc', 'Equipment hire');
		set('#l-from', 'Valley Rentals');
		set('#l-cost', '60.00');
	})()`);
	check(await click('Add the line'), 'a hire is added to it');
	await settle(5500);
	const onIt = /** @type {string} */ (await text());
	check(
		(await evaluate('location.pathname')) === '/invoices/on-phone' &&
			/Equipment hire.*On this phone.*Due \$60\.00/.test(onIt),
		'the draft on the phone shows it, and comes to $60.00'
	);
	await go('/invoices');
	check(
		new RegExp(`New draft · ${STARTED_FOR}.*On this phone.*1 line`).test(await text()),
		'the invoices list shows the draft on the phone'
	);

	// Lines the server has, changed with no signal: on lines-check's draft, the
	// only one for Harbor Light Dental.
	const d13 = /** @type {string | null} */ (
		await run(
			() =>
				[...document.querySelectorAll('a.rec.link')]
					.find((a) => a.textContent?.includes('Harbor Light Dental'))
					?.getAttribute('href') ?? null
		)
	);
	await go(d13 ?? '/invoices');
	const jacks = /** @type {string | null} */ (await lineHref('Keystone jacks ×12'));
	const permit = /** @type {string | null} */ (await lineHref('Low-voltage permit'));
	await run(
		(/** @type {string} */ key, /** @type {string} */ value) => localStorage.setItem(key, value),
		CHANGED,
		JSON.stringify({ d13, jacks, permit })
	);
	await go(`${jacks}/change`);
	check(
		(await heading()).startsWith('Change the line'),
		'a line on the server opens to be changed with no server'
	);
	await evaluate(`(() => {
		const set = (id, v) => {
			const f = document.querySelector(id);
			f.value = v;
			f.dispatchEvent(new Event('input', { bubbles: true }));
		};
		set('#l-desc', 'Keystone jacks ×12, tested');
		set('#l-cost', '31.00');
	})()`);
	check(await click('Save the change'), 'the jacks are changed');
	await settle(5500);
	check(
		(await evaluate('location.pathname')) === jacks &&
			(await text()).includes('A change made on this phone waits to send.'),
		'the change waits on the phone, and the line says so'
	);
	await go(`${permit}/change`);
	await evaluate(`(() => {
		const f = document.querySelector('#l-desc');
		f.value = 'Low-voltage permit, LV-26-0418';
		f.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await click('Save the change');
	await settle(5500);
	await go(d13 ?? '/invoices');
	const marked = /** @type {string} */ (await text());
	check(
		(marked.match(/Changed on this phone/g) ?? []).length === 2,
		'the draft marks both lines as changed on this phone'
	);

	// Time entries the server has, changed and removed with no signal, from All
	// entries' copy: only Avery's own, to change on site.
	const entries = /** @type {{ toChange: string, toRemove: string, toAddAgain: string }} */ (
		JSON.parse(/** @type {string} */ (await evaluate(`localStorage.getItem('${ENTRIES}') ?? '{}'`)))
	);
	await go('/timesheet/all');
	const yours = /** @type {string} */ (await text());
	check(
		(await subtitle()) === 'Yours, this week and last' &&
			yours.includes('Patched the front desk') &&
			!yours.includes('Replaced the front desk switch') &&
			yours.includes('need a connection'),
		'All entries opens with no server, holding only your own entries to change'
	);
	await go(`/timesheet/${entries.toChange}`);
	check(
		(await heading()) === 'Change an entry',
		'an entry the server has opens to be changed with no server'
	);
	await typeIn('#m-note', 'Patched the front desk, offline');
	await typeIn('#m-length', '1:30');
	check(await click('Save changes'), 'it is changed');
	await settle(5500);
	await go(`/timesheet/${entries.toAddAgain}`);
	await typeIn('#m-note', 'Labelled the patch panel and the drops');
	await click('Save changes');
	await settle(5500);
	await go(`/timesheet/${entries.toRemove}`);
	await click('Remove this entry');
	await settle(300);
	await evaluate(
		`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Remove')?.click()`
	);
	await settle(5500);
	await go('/timesheet/all');
	const entriesMarked = /** @type {string} */ (await text());
	check(
		/Patched the front desk, offline.*Changed on this phone.*1\.5000 hr/.test(entriesMarked) &&
			/Checked the wiring closet.*Removed on this phone/.test(entriesMarked),
		'All entries shows the change as made, and the removal, both waiting on the phone'
	);
	await go(`/timesheet/${entries.toChange}`);
	const waits = /** @type {string} */ (await text());
	check(
		waits.includes('A change made on this phone waits to send.') &&
			(await evaluate(`document.querySelector('#m-note')?.value`)) ===
				'Patched the front desk, offline',
		'the entry opens on the change it waits with'
	);

	// A trip recorded, and Avery's own drive yesterday changed, with no signal.
	await go('/trips');
	check(
		(await heading()).startsWith('Trips') && /Offline/.test(await banner()),
		'/trips opens with no server, saying how old it is'
	);
	const tripsShown = /** @type {string} */ (await text());
	check(
		!tripsShown.includes('Sam Ortega') && tripsShown.includes('everyone else’s'),
		'it lists Avery’s own trips, and says everyone else’s need a connection'
	);
	await go(SAMS_TRIP);
	check((await heading()) === 'No connection', 'Sam’s trip says it needs a connection');
	const own = /** @type {string | null} */ (
		await evaluate(`localStorage.getItem(${JSON.stringify(OWN_TRIP)})`)
	);
	if (own) {
		await go(own);
		const drive = /** @type {string} */ (await text());
		check(
			drive.includes('Offline check yard') &&
				drive.includes('needs a connection') &&
				!drive.includes('Paid for the vehicle'),
			'her own trip opens with no server: the drive, and nothing it bills'
		);
	}
	await go('/trips/new');
	for (const [client, site] of [
		['Harbor Light Dental', 'Woodland office'],
		['Valley Oak Veterinary', 'Clinic']
	]) {
		await click('Add a stop');
		await settle(300);
		await choose('#s-client', client);
		await settle(200);
		await choose('#s-site', site);
		await settle(200);
		await click('Add the stop');
		await settle(400);
	}
	await settle(1500);
	const drives = /** @type {string} */ (await text());
	check(
		drives.includes('as last driven') && drives.includes("Google's route when it arrives"),
		"New trip opens with no server, each drive as last driven, Google's route to come"
	);
	// What the drives came to here, as last driven: what the trip arrives with,
	// Google having no key in this run. Which earlier trip drove them last turns
	// on the clocks the run is under, so the figure is read, not assumed.
	const driven = /** @type {number} */ (
		await evaluate(
			`[...document.querySelectorAll('.mi input')].reduce((n, i) => n + Number(i.value), 0)`
		)
	);
	await typeIn('#t-note', 'Recorded offline by offline-check');
	await click('Save the trip');
	await settle(6500);
	const listed = /** @type {string} */ (await text());
	const newKey = /** @type {string | null} */ (
		await inQueue(`const all = db.transaction('trips').objectStore('trips').getAll();
			all.onsuccess = () => done(all.result.find((q) => !q.trip.trip_id)?.trip.key ?? null);
			all.onerror = () => done(null);`)
	);
	check(
		(await evaluate('location.pathname')) === '/trips' &&
			listed.includes('On this phone') &&
			listed.includes('Woodland office, Clinic') &&
			newKey !== null,
		'the trip waits on the phone, and the list shows it'
	);
	if (own) {
		await go(`${own}/change`);
		check(
			(await heading()).startsWith('Change the trip'),
			'her trip opens to be changed with no server'
		);
		await typeIn('#t-note', 'Changed offline by offline-check');
		await click('Save the trip');
		await settle(6500);
		check(
			(await text()).includes('a change to a saved trip'),
			'the change waits on the phone beside it'
		);
	} else failures.push('could not find Avery’s own trip');
	await evaluate(
		`localStorage.setItem(${JSON.stringify(TRIPS)}, ${JSON.stringify(JSON.stringify({ newKey, own, driven }))})`
	);

	// STOCK WITH NO SIGNAL (#lib/queue): Materials with quantities alone; a
	// receipt with something new on it, drawn on a line at once; an
	// adjustment; and a count, started on the phone.
	await go('/catalogue/materials');
	const fibre = /** @type {string} */ (
		await run(
			() =>
				[...document.querySelectorAll('a.box-row')]
					.find((a) => a.textContent?.includes('Fibre patch lead'))
					?.getAttribute('href')
					?.split('/')
					.pop() ?? ''
		)
	);
	check(
		(await heading()) === 'Catalogue' && !!fibre && !/\$\d/.test(await text()),
		'Materials opens with no server, with quantities alone'
	);
	await go('/catalogue/receipts/new');
	check((await heading()) === 'Receive stock', 'Receive opens with no server');
	await typeIn('#r-from', 'Corner Hardware');
	await evaluate(`document.querySelector('#rcv-tab-items').click()`);
	await settle(300);
	await click('Add an item');
	await settle(400);
	await run(() => {
		const s = /** @type {HTMLSelectElement} */ (document.querySelector('#d-item'));
		s.value = '';
		s.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await settle(300);
	await typeIn('#d-name', TIES);
	await choose('#d-unit', 'each');
	await typeIn('#d-count', '100');
	await typeIn('#d-price', '12.00');
	await click('Add item');
	await settle(400);
	await click('Receive');
	await settle(6000);
	const received = /** @type {string} */ (await text());
	check(
		(await evaluate('location.pathname')) === '/catalogue/materials' &&
			received.includes('Received from Corner Hardware') &&
			received.includes('Waiting to send'),
		'a receipt with something new on it waits on the phone, and Materials says so'
	);
	const phoneDraft = /** @type {string} */ (
		await evaluate(`localStorage.getItem(${JSON.stringify(STARTED)}) ?? ''`)
	);
	await go(`/invoices/on-phone/add?draft=${encodeURIComponent(phoneDraft)}`);
	await settle(1500);
	const offering = /** @type {string} */ (await text());
	check(
		offering.includes(TIES) && offering.includes('100 each on the shelf'),
		'what it put on the shelf can go on a line at once'
	);
	await run(
		(/** @type {string} */ name) =>
			/** @type {HTMLButtonElement | undefined} */ (
				[...document.querySelectorAll('button.rec')].find((b) => b.textContent?.includes(name))
			)?.click(),
		TIES
	);
	await settle(200);
	await typeIn('#l-qty', '10');
	await click('Add the line');
	await settle(5500);
	check(
		((await linesQueued()) ?? []).some((l) => l.description === TIES),
		'10 of them go on the draft started on the phone, waiting with it'
	);
	await go(`/catalogue/materials/${fibre}`);
	await click('Adjust');
	await settle(400);
	await typeIn('#a-qty', '1');
	await click('Take it off');
	await settle(5500);
	const adjusted = /** @type {string} */ (await text());
	check(
		adjusted.includes('Take 1 each off') && adjusted.includes('Waiting to send'),
		'a patch lead used in the shop waits on the phone, on its own screen'
	);
	await go('/catalogue/materials');
	await click('Count');
	await settle(3000);
	const counting = /** @type {string} */ (await evaluate('location.pathname + location.search'));
	// Two short of what the sheet says is on hand.
	const onHand = Number(
		/** @type {string} */ (
			await run(
				(/** @type {string} */ id) =>
					document
						.querySelector(`#c-${id}`)
						?.closest('.cl')
						?.textContent?.match(/([\d,.]+) each on hand/)?.[1]
						?.replace(/,/g, '') ?? 'NaN',
				fibre
			)
		)
	);
	await typeIn(`#c-${fibre}`, String(onHand - 2));
	await run(
		(/** @type {string} */ sel) =>
			document.querySelector(sel)?.dispatchEvent(new Event('change', { bubbles: true })),
		`#c-${fibre}`
	);
	await settle(5500);
	const countedHere = /** @type {string} */ (await text());
	check(
		counting.startsWith('/catalogue/counts/on-phone?count=') &&
			countedHere.includes('On this phone') &&
			countedHere.includes('−2 each'),
		`a count is started on the phone, and the patch leads counted 2 short (${counting} ${countedHere.slice(countedHere.lastIndexOf('Fibre patch lead'), countedHere.lastIndexOf('Fibre patch lead') + 160)})`
	);
	// The receipt, the adjustment, the count started and what is counted on it.
	check((await stockQueued()) === 4, `all of it waits on the phone (${await stockQueued()})`);
	await run(
		(/** @type {string} */ key, /** @type {string} */ value) => localStorage.setItem(key, value),
		STOCK,
		JSON.stringify({ fibre })
	);

	// TWO WEEKS WITHOUT THE SERVER: the session has ended there, and the phone
	// forgets its copies by itself. The work on it stays.
	const waitingBefore = ((await queued()) ?? []).length;
	await run(async () => {
		const name = (await caches.keys()).find((k) => k.startsWith('pages-'));
		if (name)
			await (
				await caches.open(name)
			).put('/__confirmed', new Response(String(Date.now() - 15 * 86_400_000)));
	});
	await go('/');
	check(
		(await heading()) === 'No connection' && ((await kept()) ?? []).length === 0,
		'two weeks after the server last answered, the phone has forgotten its copies'
	);
	check(
		((await queued()) ?? []).length === waitingBefore && waitingBefore > 0,
		`and keeps every entry waiting to send (${waitingBefore})`
	);
}

/** The browser's session cookie for the app, to hand back later. */
const sessionNow = async () =>
	/** @type {{ name: string, value: string }[]} */ (
		(await send('Network.getCookies', { urls: [base] })).result.cookies
	).find((c) => /session_token$/.test(c.name));
/** Puts a session in the browser, as the sign-in page would. */
const useSession = (/** @type {{ name: string, value: string }} */ { name, value }) =>
	send('Network.setCookie', {
		name,
		value,
		url: base,
		httpOnly: true,
		sameSite: 'Lax',
		secure: name.startsWith('__Secure-')
	});

if (phase === 'back' && other) {
	// SOMEONE ELSE ON THIS PHONE, before the one who recorded it all is back.
	const recorded = (await queued()) ?? [];
	const theirs = await sessionNow();
	await useSession(await signIn(base, other));
	await go('/timesheet');
	await settle(2500);
	const still = (await queued()) ?? [];
	check(
		recorded.length > 0 &&
			still.length === recorded.length &&
			still.every((q) => q.refused === null),
		`someone else signed in on this phone sends none of what was recorded offline (${still.length} of ${recorded.length} kept, unsent)`
	);
	check(!/waiting to send/.test(await text()), 'nor is shown it');

	// A timer of theirs, then signing out with it running: asked first, and it
	// keeps running.
	await go('/timesheet/start');
	await evaluate(`(() => {
		const s = document.querySelector('#s-service');
		s.value = [...s.options].find((o) => o.value)?.value ?? '';
		s.dispatchEvent(new Event('change', { bubbles: true }));
		document.querySelector('button.tog.on')?.click();
	})()`);
	await settle(300);
	await click('Start the clock');
	await settle(1500);
	check((await stored('reckon.running')) === 1, 'they start a timer, which runs on the phone');
	await evaluate(`document.querySelector('form[action="/logout"]')?.requestSubmit()`);
	await settle(1000);
	const asked = await evaluate(
		`document.querySelector('dialog[open]')?.textContent?.replace(/\\s+/g, ' ') ?? ''`
	);
	check(
		/1 timer is still running/.test(asked) &&
			/Nobody else who signs in here sees any of it/.test(asked),
		'signing out with it running says so first'
	);
	await evaluate(
		`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Sign out')?.click()`
	);
	await settle(2500);
	check(
		(await evaluate('location.pathname')) === '/login' && (await stored('reckon.running')) === 1,
		'and once they say so, they are signed out, the timer still running on the phone'
	);
	// What was kept for them is gone with them; the app's own files are not,
	// and nor is anyone's work waiting to send.
	const caches_ = /** @type {{ pages: number, shell: number }} */ (
		await evaluate(`(async () => {
			const keys = await caches.keys();
			const count = async (prefix) => {
				const name = keys.find((k) => k.startsWith(prefix));
				return name ? (await (await caches.open(name)).keys()).length : 0;
			};
			return { pages: await count('pages-'), shell: await count('shell-') };
		})()`)
	);
	check(
		caches_.pages === 0 && caches_.shell > 0,
		`signing out empties the copies kept for them, and leaves the app’s own files (${caches_.shell})`
	);
	check(
		((await queued()) ?? []).length === recorded.length,
		'and the work waiting on the phone stays, still unsent'
	);
	if (theirs) await useSession(theirs);
}

if (phase === 'back') {
	await go('/timesheet');
	await settle(2500);
	if (other)
		check(
			(await stored('reckon.running')) === 1 &&
				!(await evaluate(
					`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Stop')`
				)),
			'back, the one who recorded it never sees the other’s timer, nor stops it'
		);
	const left = (await queued()) ?? [];
	check(
		left.length === 1 && left[0].refused !== null,
		'opening a page with the server back posts the queue'
	);
	check(
		left[0]?.refused === 'That service no longer exists.',
		`the one naming a deleted service is kept, with the reason "${left[0]?.refused ?? ''}"`
	);

	// Reload so the screen reads the queue as it now is.
	await go('/timesheet');
	const shown = await evaluate(`(() => {
		const sec = [...document.querySelectorAll('.sec')].find((s) => s.querySelector('h2')?.textContent?.trim() === 'Not saved');
		return sec ? sec.textContent.replace(/\\s+/g, ' ') : '';
	})()`);
	check(
		/That service no longer exists\./.test(shown) && /1:20/.test(shown),
		'Time shows it as not saved, with the reason'
	);

	await evaluate(
		`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Fix')?.click()`
	);
	await settle(2000);
	const form = await evaluate(`({
		heading: document.querySelector('h1')?.textContent?.trim() ?? '',
		start: document.querySelector('#m-start')?.value ?? '',
		took: document.querySelector('#m-length')?.value ?? '',
		end: document.querySelector('#m-end')?.value ?? '',
		service: document.querySelector('#m-service')?.selectedOptions[0]?.textContent?.trim() ?? ''
	})`);
	const filledIn =
		form.heading.startsWith('Fix an entry') &&
		/^\d\d:\d\d$/.test(form.start) &&
		form.took === '1:20' &&
		/^\d\d:\d\d$/.test(form.end) &&
		form.service === 'Choose what was done';
	check(
		filledIn,
		`Fix opens it filled in, with the deleted service left to choose again${filledIn ? '' : ` (${JSON.stringify(form)})`}`
	);

	await go('/timesheet');
	await click('Discard');
	await settle(300);
	check((await queued())?.length === 1, 'one tap does not discard it');
	await click('Tap again to discard');
	await settle(800);
	check((await queued())?.length === 0, 'the second tap does');

	// The lines went after the time: the permit and the hire are in, and the
	// raceway is kept.
	const lines = (await linesQueued()) ?? [];
	check(
		lines.length === 1 && lines[0].description === 'Raceway · Surface · 3/4 in',
		'the permit and the hire reach the server; the raceway is kept on the phone'
	);
	check(
		/^Only \d+ ft of Raceway · Surface · 3\/4 in on the shelf\.$/.test(lines[0]?.refused ?? ''),
		`with the reason "${lines[0]?.refused ?? ''}"`
	);
	// INV-0212 went out before the permit arrived: it started a new draft.
	await go(DRAFT);
	await settle(1500);
	const page = /** @type {string} */ (await text());
	const moved = /A line added to this on a phone after it went out is on (INV-\d+)\./.exec(page);
	check(
		(await heading()).startsWith('INV-0212') && moved !== null,
		`INV-0212, sent meanwhile, says where the permit went${moved ? ` (${moved[1]})` : ''}`
	);
	check(
		/Not added.*Raceway · Surface · 3\/4 in.*Refused: Only \d+ ft/.test(page),
		'the raceway shows on it as not added, with the reason'
	);
	await run((/** @type {string} */ number) => {
		const a = [...document.querySelectorAll('.why a')].find(
			(x) => x.textContent?.trim() === number
		);
		/** @type {HTMLElement | undefined} */ (a)?.click();
	}, moved?.[1] ?? '');
	await settle(2000);
	const fresh = /** @type {string} */ (await text());
	// The permit's receipt, from its line's own screen.
	const receipt = await evaluate(`(async () => {
		const a = [...document.querySelectorAll('a.rec.link')].find((a) => a.textContent.includes('City of Woodland'));
		if (!a) return null;
		const r = await fetch(a.getAttribute('href') + '/receipt');
		return { status: r.status, type: r.headers.get('content-type') };
	})()`);
	check(
		(await heading()).startsWith(`Draft ${moved?.[1] ?? '?'}`) &&
			/INV-0212 went out .* while a line added to it on a phone was on the way\. It could not join it, so this draft was started for Marisol Vega/.test(
				fresh
			),
		'the new draft says why it was started'
	);
	check(
		fresh.includes('Paid for them · City of Woodland · the business paid · at cost') &&
			fresh.includes('Moved from INV-0212') &&
			receipt?.status === 200 &&
			receipt.type === 'image/jpeg',
		'the permit is on it, moved from INV-0212, with its receipt'
	);

	await go(DRAFT);
	await settle(1000);
	await evaluate(
		`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Fix')?.click()`
	);
	await settle(2000);
	const fix = await evaluate(`({
		heading: document.querySelector('h1')?.textContent?.trim() ?? '',
		qty: document.querySelector('#l-qty')?.value ?? '',
		why: [...document.querySelectorAll('.why')].map((w) => w.textContent.replace(/\\s+/g, ' ').trim())
	})`);
	check(
		fix.heading.startsWith('Add a line') &&
			fix.qty === '1000' &&
			fix.why[0]?.startsWith('Refused: Only ') &&
			fix.why[1] ===
				'INV-0212 has gone out, so this line will start a new draft for Marisol Vega when it reaches the server.',
		`Fix opens it filled in, with the reason and where it will go${fix.qty === '1000' ? '' : ` (${JSON.stringify(fix)})`}`
	);
	await go(DRAFT);
	await settle(1000);
	await click('Discard');
	await settle(300);
	check((await linesQueued())?.length === 1, 'one tap does not discard a line');
	await click('Tap again to discard');
	await settle(800);
	check((await linesQueued())?.length === 0, 'the second tap does');

	// lines-check's lines, changed here while Sam changed them there.
	const changed = /** @type {{ d13: string, jacks: string, permit: string }} */ (
		JSON.parse(
			/** @type {string} */ (
				await evaluate(`localStorage.getItem(${JSON.stringify(CHANGED)}) ?? '{}'`)
			)
		)
	);
	await go(changed.d13);
	await settle(1500);
	const d13 = /** @type {string} */ (await text());
	check(
		d13.includes('Changed in two places') &&
			/Taken off while this phone was offline.*Low-voltage permit, LV-26-0418.*Sam Ortega took it off/.test(
				d13
			),
		'the draft says which change collided, and which line was taken off meanwhile'
	);
	await go(changed.jacks);
	await settle(1000);
	const collided = /** @type {string} */ (await text());
	check(
		/Description Merged.*Keystone jacks ×12, tested.*Only you changed it/.test(collided) &&
			/From Merged.*Valley Hardware, Woodland.*Only Sam Ortega changed it/.test(collided) &&
			/Cost before tax — pick one.*\$33\.33.*\$30\.00.*\$29\.00.*\$31\.00.*You · on this phone/.test(
				collided
			),
		`the jacks' description and supplier merge, and their cost is picked from every value it has held${collided.includes('pick one') ? '' : ` (${collided.slice(0, 500)})`}`
	);
	check(await click('Keep these'), "the phone's cost is kept");
	await settle(5500);
	const settled = /** @type {string} */ (await text());
	check(
		(await heading()).startsWith('Keystone jacks ×12, tested') &&
			settled.includes('From Valley Hardware, Woodland') &&
			settled.includes('Charged $31.00') &&
			!settled.includes('pick one'),
		'the jacks have both changes, and the cost picked'
	);
	await go(changed.d13);
	await settle(1000);
	check(await click('Put it back, with your change'), 'the permit is put back');
	await settle(5500);
	await go(changed.d13);
	await settle(1000);
	const back = /** @type {string} */ (await text());
	const permitBack = /** @type {string | null} */ (
		await lineHref('Low-voltage permit, LV-26-0418')
	);
	check(
		permitBack === changed.permit && !back.includes('Taken off while this phone was offline'),
		'the permit is on the draft again, as the same line, with its change'
	);
	await go(`${changed.permit}/history`);
	const story = /** @type {string} */ (await text());
	check(
		/Taken off the draft.*Sam Ortega.*Put back on the draft/.test(story),
		'its history has Sam taking it off, and it being put back'
	);

	// The entries changed here while Sam changed them there.
	const entries =
		/** @type {{ toChange: string, toRemove: string, toAddAgain: string, month: string }} */ (
			JSON.parse(
				/** @type {string} */ (await evaluate(`localStorage.getItem('${ENTRIES}') ?? '{}'`))
			)
		);
	await go(`/timesheet/all?month=${entries.month}`);
	const listedBack = /** @type {string} */ (await text());
	check(
		/Changed in two places/.test(listedBack) && /Changed since you removed it/.test(listedBack),
		'All entries says which change collided, and which entry was changed after it was removed here'
	);
	await go(`/timesheet/${entries.toChange}`);
	await settle(1000);
	const picking = /** @type {string} */ (await text());
	check(
		/When Merged.*1\.5 hr.*Only you changed it, on this phone/.test(picking) &&
			/Billable Merged.*Not billable.*Only Sam Ortega changed it/.test(picking) &&
			/Note — pick one.*“Patched the front desk”.*Where both started.*“Patched the front desk, by Sam”.*Sam Ortega.*“Patched the front desk, offline”.*You · on this phone/.test(
				picking
			),
		`how long it took merges from the phone and whether it bills from Sam, and the note is picked${picking.includes('pick one') ? '' : ` (${picking.slice(0, 400)})`}`
	);
	check(await click('Keep these'), "the phone's note is kept");
	await settle(5500);
	await go(`/timesheet/${entries.toChange}`);
	const changedForm = await evaluate(`({
		note: document.querySelector('#m-note')?.value ?? '',
		took: document.querySelector('#m-length')?.value ?? '',
		text: document.body.textContent.replace(/\\s+/g, ' ')
	})`);
	check(
		changedForm.note === 'Patched the front desk, offline' &&
			changedForm.took === '1:30' &&
			!changedForm.text.includes('pick one') &&
			!changedForm.text.includes('waits to send'),
		`the entry has both changes, and the note picked${changedForm.note ? ` (${changedForm.note}, ${changedForm.took})` : ''}`
	);
	await go(`/timesheet/${entries.toRemove}`);
	await settle(1000);
	check(
		/Sam Ortega changed this entry.*after it was removed on this phone/.test(
			/** @type {string} */ (await text())
		),
		'the entry removed here says Sam changed it since'
	);
	check(await click('Remove it anyway'), 'and is removed anyway');
	await settle(5500);
	// Removed meanwhile, the third has no screen to open: Time has it, to be
	// added again with the change.
	await go('/timesheet');
	const notSaved = /** @type {string} */ (
		await evaluate(`(() => {
			const sec = [...document.querySelectorAll('.sec')].find((s) => s.querySelector('h2')?.textContent?.trim() === 'Not saved');
			return sec ? sec.textContent.replace(/\\s+/g, ' ') : '';
		})()`)
	);
	const saysRemoved =
		/Labelled the patch panel and the drops.*Sam Ortega removed this entry at .*, while your change waited on this phone/.test(
			notSaved
		);
	check(
		saysRemoved,
		`Time says an entry changed here was removed meanwhile, and by whom${saysRemoved ? '' : ` (${notSaved.slice(0, 500)})`}`
	);
	check(await click('Add it again, with your change'), 'and adds it again, with the change');
	/** @type {Awaited<ReturnType<typeof timeChangesQueued>>} */
	let changesLeft = null;
	for (let i = 0; i < 15; i++) {
		await settle(1000);
		changesLeft = await timeChangesQueued();
		if (changesLeft?.length === 0) break;
	}
	await go(`/timesheet/all?month=${entries.month}`);
	// The rows alone: the sign-out dialog, closed, says "on this phone" too.
	const entriesAfter = /** @type {string} */ (
		await evaluate(
			`[...document.querySelectorAll('.rows')].map((r) => r.textContent).join(' ').replace(/\\s+/g, ' ')`
		)
	);
	const gone = !entriesAfter.includes('Checked the wiring closet');
	const stays =
		/Patched the front desk, offline/.test(entriesAfter) &&
		/Labelled the patch panel and the drops/.test(entriesAfter);
	const quiet = !/on this phone|two places/.test(entriesAfter);
	check(
		changesLeft?.length === 0 && gone && stays && quiet,
		`one is gone, one is back as a new entry, and nothing about them waits on the phone${changesLeft?.length === 0 && gone && stays && quiet ? '' : ` (${JSON.stringify({ changesLeft, gone, stays, quiet })} ${entriesAfter.slice(entriesAfter.indexOf('Week of'), entriesAfter.indexOf('Week of') + 600)})`}`
	);

	// The draft started on the phone arrived, numbered, with its hire.
	const drafts = await inQueue(`const all = db.transaction('drafts').objectStore('drafts').getAll();
		all.onsuccess = () => done(all.result.length);
		all.onerror = () => done(null);`);
	const uuid = /** @type {string} */ (
		await evaluate(`localStorage.getItem(${JSON.stringify(STARTED)}) ?? ''`)
	);
	await go(`/invoices/on-phone?draft=${encodeURIComponent(uuid)}`);
	await settle(2000);
	const arrived = /** @type {string} */ (await text());
	check(
		drafts === 0 &&
			/^\/invoices\/[0-9a-f-]{36}$/.test(await evaluate('location.pathname')) &&
			(await heading()).startsWith('Draft INV-') &&
			(await subtitle()).includes(STARTED_FOR) &&
			arrived.includes('Paid for them · Valley Rentals') &&
			!arrived.includes('On this phone'),
		'the draft started on the phone arrives numbered with its hire, and its screen gives way to it'
	);

	// The trip and the change arrive; the drive's estimates were the last drive's,
	// and Google, with no key here, has nothing to put in their place.
	const trips = /** @type {{ newKey: string | null; own: string | null; driven: number }} */ (
		JSON.parse(
			/** @type {string} */ (
				await evaluate(`localStorage.getItem(${JSON.stringify(TRIPS)}) ?? '{}'`)
			)
		)
	);
	await go('/trips');
	await settle(2500);
	const tripsLeft =
		await inQueue(`const all = db.transaction('trips').objectStore('trips').getAll();
		all.onsuccess = () => done(all.result.length);
		all.onerror = () => done(null);`);
	const found = trips.newKey
		? /** @type {{ id?: string } | null} */ (
				await evaluate(
					`fetch('/api/trips?client_uuid=${trips.newKey}').then((r) => (r.ok ? r.json() : null))`
				)
			)
		: null;
	check(
		tripsLeft === 0 && !(await text()).includes('On this phone') && !!found?.id,
		'the trip recorded and the change made with no signal arrive'
	);
	if (found?.id) {
		await go(`/trips/${found.id}`);
		const arrivedTrip = /** @type {string} */ (await text());
		check(
			arrivedTrip.includes('Recorded offline by offline-check') &&
				arrivedTrip.includes('Woodland office') &&
				arrivedTrip.includes(`${trips.driven.toFixed(1)} mi driven`) &&
				/Leg assignment.*Harbor Light Dental.*Valley Oak Veterinary/i.test(arrivedTrip),
			`the trip is as it was recorded, its legs worked out on arrival (${trips.driven.toFixed(1)} mi)`
		);
	}
	if (trips.own) {
		await go(trips.own);
		check(
			(await text()).includes('Changed offline by offline-check'),
			'her own trip has the change'
		);
	}

	// THE STOCK ARRIVES, before the lines that draw it: the receipt with
	// something new on it, then the 10 drawn from it, the patch lead used, and
	// the count started on the phone -- open now, its figure showing the lead
	// used since it was counted.
	const { fibre } = JSON.parse(
		/** @type {string} */ (await evaluate(`localStorage.getItem(${JSON.stringify(STOCK)}) ?? '{}'`))
	);
	await go('/catalogue/materials');
	const stocked = /** @type {string} */ (await text());
	const countHref = /** @type {string} */ (
		await evaluate(
			`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Carry on counting')?.getAttribute('href') ?? ''`
		)
	);
	check(
		(await stockQueued()) === 0 &&
			new RegExp(`${TIES}.*90 each left`).test(stocked) &&
			stocked.includes('A count is open'),
		`the receipt arrives with something new on it, the line takes 10, and the count is open${(await stockQueued()) === 0 ? '' : ` (${await stockQueued()} still on the phone)`}`
	);
	await go(`/catalogue/materials/${fibre}/adjustments`);
	const used = /** @type {string} */ (await text());
	check(
		used.includes('Used in the shop') && used.includes('−1 each'),
		'the patch lead used arrives'
	);
	await go(countHref || '/catalogue/materials');
	const theCount = /** @type {string} */ (await text());
	check(
		theCount.includes('Fibre patch lead') &&
			theCount.includes('−2 each') &&
			theCount.includes('Moved since'),
		`the count holds the leads counted on the phone, and says one was used since (${countHref} ${theCount.slice(theCount.lastIndexOf('Fibre patch lead'), theCount.lastIndexOf('Fibre patch lead') + 200)})`
	);

	await evaluate(`document.querySelector('form[action="/logout"]')?.requestSubmit()`);
	await settle(2500);
	const after = await evaluate(`location.pathname`);
	const cached = (await kept()) ?? [];
	check(after === '/login' && cached.length === 0, 'signing out empties what the worker kept');
}

check(
	uncaught.length === 0,
	`nothing is left uncaught${uncaught.length ? `: ${[...new Set(uncaught)].join(' | ')}` : ''}`
);

ws.close();
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${line(f)}`);
	process.exit(1);
}
console.log(`\nOffline, ${phase}: as expected.`);
