#!/usr/bin/env node
/**
 * Exercises everything that WRITES, and checks what it wrote.
 *
 *   node tests/write-check.mjs <base-url> <email>
 *
 * WHY THIS EXISTS. smoke.mjs asks every route for a status code and
 * console-check.mjs walks every screen -- both only ever GET. If
 * /api/time inserted into a column that had been dropped, every time entry
 * would fail and both would stay green: the pages render, the routes answer,
 * and nothing has tried to save anything.
 *
 * A read-only test suite on a system whose whole job is recording work is a
 * suite that cannot see the failure that matters.
 *
 * It is not clean. It leaves an entry it posted, the settings and terms it
 * saved, and the site it closed, so run it against a scratch database.
 */
import { database } from '../scripts/env.mjs';
import pg from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { signIn } from './passkeys.mjs';

const [, , base = 'http://localhost:5181', email] = process.argv;

// In production a TLS proxy stands in front, and the server takes the scheme
// from it. Over plain http this says what that proxy would -- the server is
// started with PROTOCOL_HEADER=x-forwarded-proto to read it. Without it the
// server assumes https, and refuses every form post as cross-site.
/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

let passed = 0;
const failures = [];

const { cookie } = await signIn(base, email);
const H = { cookie, 'content-type': 'application/json', origin: base, ...PROXY };

/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} [payload]
 * @returns {Promise<{ status: number; body: any }>}
 */
const call = async (method, path, payload) => {
	const res = await fetch(base + path, {
		method,
		headers: H,
		body: payload === undefined ? undefined : JSON.stringify(payload)
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		/* a 204 or an HTML error page */
	}
	return { status: res.status, body };
};

/** `want` is a status, or a function given the response. */
/**
 * @param {string} label
 * @param {string} method
 * @param {string} path
 * @param {unknown} payload
 * @param {number | ((r: { status: number; body: any }) => boolean)} want
 */
const check = async (label, method, path, payload, want) => {
	const r = await call(method, path, payload);
	const ok = typeof want === 'function' ? want(r) : r.status === want;
	if (ok) passed++;
	else failures.push(`${label}: got ${r.status} ${JSON.stringify(r.body)?.slice(0, 120) ?? ''}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
	return r;
};

/**
 * A refusal of its kind: what a client branches on is the type, and each is
 * sent with its one status (#lib/problem).
 */
const RACED = '/problems/changed-meanwhile';
const AS_IT_STANDS = '/problems/not-as-things-stand';
const refused =
	(/** @type {string} */ type, /** @type {number} */ status = 409) =>
	/** @param {{ status: number; body: any }} r */ (r) =>
		r.status === status && r.body?.type === type;

// ---------------------------------------------------------------------------
// What the app already has to work with.

const seen = await (await fetch(`${base}/clients`, { headers: { cookie } })).text();
// Not the first /clients/ link on the page -- that is Contacts, which is a
// screen rather than a client and answers 404 to a client endpoint.
const clientSlug = [...seen.matchAll(/\/clients\/([a-z0-9-]+)"/g)]
	.map((m) => m[1])
	.find((slug) => slug !== 'contacts');
if (!clientSlug) {
	console.error('  no client to test against');
	process.exit(2);
}
// A second client, to prove a site cannot be reached through the wrong one.
const otherSlug = [...seen.matchAll(/\/clients\/([a-z0-9-]+)"/g)]
	.map((m) => m[1])
	.find((slug) => slug !== 'contacts' && slug !== clientSlug);

/** The options of one named select, so a service id is not mistaken for a client's. */
const optionsOf = (/** @type {string} */ html, /** @type {string} */ id) => {
	const select = html.match(new RegExp(`id="${id}"[\\s\\S]*?</select>`))?.[0] ?? '';
	return [...select.matchAll(/<option value="([0-9a-f-]{36})"[^>]*>([^<]*)</g)].map((m) => ({
		id: m[1],
		label: m[2].trim()
	}));
};

console.log('\n  time entries');

const entry = {
	worked_on: new Date().toISOString().slice(0, 10),
	minutes: 15,
	crew: 'one',
	billable: false,
	note: 'write-check',
	service_id: null
};

const manual = await (await fetch(`${base}/timesheet/manual`, { headers: { cookie } })).text();
const serviceId = optionsOf(manual, 'm-service')[0]?.id;

if (serviceId) {
	// A TEAM entry naming no crew, as a phone queued before entries named
	// theirs: it is taken as everybody holding a role. The people are rendered
	// as buttons and carry no id in the markup, and inventing a user id here
	// would test the foreign key rather than the insert -- which is below.
	const one = {
		...entry,
		service_id: serviceId,
		crew: 'team',
		worked_by: null,
		client_uuid: crypto.randomUUID()
	};
	await check('an entry saves', 'POST', '/api/time', one, 200);
	await check('the same entry again is not a second one', 'POST', '/api/time', one, 200);
	await check(
		'a solo entry naming nobody is refused',
		'POST',
		'/api/time',
		{ ...one, client_uuid: crypto.randomUUID(), crew: 'one', worked_by: null },
		400
	);
	await check(
		'a team entry naming somebody is refused',
		'POST',
		'/api/time',
		{ ...one, client_uuid: crypto.randomUUID(), worked_by: crypto.randomUUID() },
		400
	);
	await check(
		'a team of one is refused',
		'POST',
		'/api/time',
		{ ...one, client_uuid: crypto.randomUUID(), crew_ids: [crypto.randomUUID()] },
		400
	);
	await check(
		'a crew naming people who do not exist is refused',
		'POST',
		'/api/time',
		{
			...one,
			client_uuid: crypto.randomUUID(),
			crew_ids: [crypto.randomUUID(), crypto.randomUUID()]
		},
		400
	);
	await check(
		"a crew on one person's entry is refused",
		'POST',
		'/api/time',
		{
			...one,
			client_uuid: crypto.randomUUID(),
			crew: 'one',
			worked_by: crypto.randomUUID(),
			crew_ids: [crypto.randomUUID(), crypto.randomUUID()]
		},
		400
	);
	await check(
		'billable work with nobody to bill is refused',
		'POST',
		'/api/time',
		{ ...one, client_uuid: crypto.randomUUID(), billable: true, entity_id: null },
		400
	);
	await check(
		'zero minutes is refused',
		'POST',
		'/api/time',
		{ ...one, client_uuid: crypto.randomUUID(), minutes: 0 },
		400
	);
	// A timed entry: its start, its end and the zone it was worked in. The
	// server works out the length and the day itself -- the day sent here is
	// wrong on purpose, and is not the one kept.
	const timed = {
		...one,
		client_uuid: crypto.randomUUID(),
		minutes: undefined,
		worked_on: '2001-01-01',
		started_at: '2026-09-16T16:00:00.400Z',
		ended_at: '2026-09-16T18:40:00.200Z',
		zone: 'America/Los_Angeles'
	};
	await check(
		'a timed entry is its start and end, its length and day worked out',
		'POST',
		'/api/time',
		timed,
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 && r.body?.seconds === 9600 && r.body?.worked_on === '2026-09-16'
	);
	await check(
		'a part of a second counts as one',
		'POST',
		'/api/time',
		{
			...timed,
			client_uuid: crypto.randomUUID(),
			started_at: '2026-09-16T16:00:00.900Z',
			ended_at: '2026-09-16T16:00:01.100Z'
		},
		(/** @type {{ status: number, body: any }} */ r) => r.status === 200 && r.body?.seconds === 1
	);
	await check(
		'an end before its start is refused',
		'POST',
		'/api/time',
		{
			...timed,
			client_uuid: crypto.randomUUID(),
			started_at: timed.ended_at,
			ended_at: timed.started_at
		},
		400
	);
	await check(
		'a zone that is not one is refused',
		'POST',
		'/api/time',
		{ ...timed, client_uuid: crypto.randomUUID(), zone: 'Mars/Olympus_Mons' },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 400 && r.body?.errors?.zone === 'Not a time zone.'
	);
	// What the phone shows when an entry recorded offline names a service
	// deleted before it got back: the queue keeps it, and this is the sentence.
	await check(
		'an entry naming a service that is gone says so',
		'POST',
		'/api/time',
		{ ...one, client_uuid: crypto.randomUUID(), service_id: crypto.randomUUID() },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 400 && r.body?.errors?.service_id === 'That service no longer exists.'
	);
} else {
	failures.push('could not find a service to post an entry with');
}

console.log('\n  a time entry changed after the fact');
if (serviceId) {
	const was = {
		...entry,
		service_id: serviceId,
		crew: 'team',
		worked_by: null,
		client_uuid: crypto.randomUUID()
	};
	const made = await call('POST', '/api/time', was);
	const id = /** @type {string | undefined} */ (made.body?.id);
	const db = new pg.Client(database());
	await db.connect();
	/** One value of the entry, or of its newest history, as the database has it. */
	const one = async (/** @type {string} */ q, /** @type {unknown[]} */ args) =>
		(await db.query(q, args)).rows[0];
	if (id) {
		const at = `/api/time/${id}`;
		// The entry as its form sends it: what a change says it began from.
		const crew = (
			await db.query('select user_id from time_entry_crew where time_entry_id = $1', [id])
		).rows
			.map((r) => r.user_id)
			.sort();
		const base = {
			worked_on: was.worked_on,
			minutes: was.minutes,
			crew: 'team',
			worked_by: null,
			crew_ids: crew,
			entity_id: null,
			site_id: null,
			service_id: serviceId,
			billable: false,
			note: was.note
		};
		const changed = { ...base, note: 'write-check, changed' };
		await check(
			'it changes, from the save it began from, and counts the save',
			'PATCH',
			at,
			{ ...changed, version: 1, base, made_at: '2026-01-02T03:04:05Z' },
			(r) => r.status === 200 && r.body?.version === 2
		);
		const kept = await one(
			`select made_at from record_history where table_name = 'time_entry' and row_id = $1
			  and field = 'note' order by changed_at desc limit 1`,
			[id]
		);
		const keptAt = kept?.made_at?.toISOString();
		const okAt = keptAt === '2026-01-02T03:04:05.000Z';
		if (okAt) passed++;
		else failures.push(`its history keeps when the change was made: ${keptAt}`);
		console.log(`  ${okAt ? '✓' : '✗'} its history keeps when the change was made, on the phone`);

		await check(
			'a change from an older copy to another part is merged with the newer',
			'PATCH',
			at,
			{ ...base, minutes: 45, version: 1, base },
			(r) => r.status === 200 && r.body?.version === 3
		);
		const merged = await one('select seconds, note from time_entry where id = $1', [id]);
		const okMerged = merged?.seconds === 2700 && merged?.note === 'write-check, changed';
		if (okMerged) passed++;
		else failures.push(`the merge kept both changes: ${JSON.stringify(merged)}`);
		console.log(`  ${okMerged ? '✓' : '✗'} and the entry has both changes`);

		await check(
			'a change from an older copy to the same part is kept for a person to pick',
			'PATCH',
			at,
			{ ...base, note: 'from an old copy', version: 1, base },
			(r) =>
				refused(RACED)(r) &&
				r.body?.conflict?.what === 'collided' &&
				r.body.conflict.collided?.join() === 'note' &&
				r.body.conflict.version === 3 &&
				r.body.conflict.server?.note === 'write-check, changed' &&
				r.body.conflict.from?.when === 'server'
		);
		await check(
			'a change that does not say what save it began from is refused',
			'PATCH',
			at,
			{ ...changed, base },
			(r) => r.status === 400 && !!r.body?.errors?.version
		);
		await check(
			'a change that does not say what the entry was then is refused',
			'PATCH',
			at,
			{ ...changed, version: 3 },
			(r) => r.status === 400 && !!r.body?.errors?.base
		);
		await check(
			'a refused field names itself, as adding one does',
			'PATCH',
			at,
			{ ...changed, minutes: 0, version: 3, base },
			(r) => r.status === 400 && !!r.body?.errors?.minutes
		);
		await check(
			'a removal that does not say what save it was made at is refused',
			'DELETE',
			at,
			undefined,
			(r) => r.status === 400 && !!r.body?.errors?.version
		);
		await check(
			'a removal from an older copy is asked about',
			'DELETE',
			`${at}?version=1`,
			undefined,
			(r) => refused(RACED)(r) && r.body?.conflict?.what === 'changed'
		);
		await check(
			'and removed anyway, once decided',
			'DELETE',
			`${at}?version=1&force=1`,
			undefined,
			200
		);
		await check('removing it again is done already', 'DELETE', `${at}?version=3`, undefined, 200);
		await check(
			'a change to one removed meanwhile says who removed it',
			'PATCH',
			at,
			{ ...changed, version: 3, base },
			(r) => refused(RACED)(r) && r.body?.conflict?.what === 'removed' && !!r.body.conflict.at
		);
		await check(
			'and one never there is not found',
			'PATCH',
			`/api/time/${crypto.randomUUID()}`,
			{ ...changed, version: 1, base },
			404
		);
	} else failures.push(`could not make an entry to change: ${made.status}`);

	// One an invoice was built from, and one a payment was recorded for, stay as they were.
	const [billed] = (
		await db.query(
			`select l.time_entry_id as id, i.status from invoice_line l join invoice i on i.id = l.invoice_id
			  where l.time_entry_id is not null limit 1`
		)
	).rows;
	const [paid] = (
		await db.query(
			`select p.time_entry_id as id from person_payment_item p
			  where p.time_entry_id is not null
			    and not exists (select 1 from invoice_line l where l.time_entry_id = p.time_entry_id)
			  limit 1`
		)
	).rows;
	await db.end();
	for (const [what, row] of /** @type {const} */ ([
		['an hour on an invoice', billed],
		['an hour in a payment', paid]
	]))
		if (row)
			await check(
				`${what} stays as it was, and says where to put it right`,
				'PATCH',
				`/api/time/${row.id}`,
				{ ...was, version: 1, base: {} },
				(r) =>
					refused(AS_IT_STANDS)(r) &&
					/draft|Credit the invoice|next payment/.test(r.body?.detail ?? '')
			);
		else console.log(`  · no ${what} in this business to try`);
}

console.log('\n  settings');
await check('a setting saves', 'PATCH', '/api/settings', { fields: { short_name: 'KFS' } }, 200);
await check(
	'a setting that does not exist is refused',
	'PATCH',
	'/api/settings',
	{ fields: { nonsense: 'x' } },
	400
);
// Numbers already used are read out of whatever format they were issued in,
// prefix and all, so numbering back over one is refused.
await check(
	'numbering back over an issued invoice is refused',
	'PATCH',
	'/api/settings',
	{ fields: { next_invoice_number: '2' } },
	400
);
await check(
	'numbering on past every issued invoice saves',
	'PATCH',
	'/api/settings',
	{ fields: { next_invoice_number: '9000' } },
	200
);

console.log('\n  clients and sites');
await check(
	'a client saves, addressed by slug',
	'PATCH',
	`/api/clients/${clientSlug}`,
	{ fields: { terms_days: '45' } },
	200
);
{
	// Empty follows the house default. Details reads it as the house default,
	// named, rather than as a number of the client's own.
	await call('PATCH', `/api/clients/${clientSlug}`, { fields: { terms_days: '' } });
	const page = await (
		await fetch(`${base}/clients/${clientSlug}/details`, { headers: { cookie } })
	).text();
	const terms =
		/Terms<\/span>[\s\S]*?<span>(?:\s|<!--[^>]*-->)*([^<]+)/.exec(page)?.[1]?.trim() ?? '';
	const ok = /^The house default of \d+ days?$/.test(terms);
	if (ok) passed++;
	else failures.push(`a client following the house default: ${terms || 'no terms row'}`);
	console.log(`  ${ok ? '✓' : '✗'} a client following the house default reads it, naming it`);
}

// A client's people: added on the client, changed on their own page, and one
// of them sent the invoices. Who the client sent them to before is put back.
console.log('\n  contacts — added to a client, changed on their own page, sent the invoices');
{
	const at = `/api/clients/${clientSlug}/contacts`;
	// Named for this run, so a second run against the same database reads its own.
	const run = Date.now().toString(36);
	const first = `Write Check Billing ${run}`;
	const other = `Write Check Second ${run}`;
	const clientPage = async () =>
		(await fetch(`${base}/clients/${clientSlug}/contacts`, { headers: { cookie } })).text();
	/** Who the client's Invoices box says they go to, and each contact's id by name. */
	const read = (/** @type {string} */ html) => ({
		bills:
			/id="bills-h"[\s\S]*?class="kv-v[^"]*">(?:\s|<!--[^>]*-->)*<span[^>]*>([^<]+)</
				.exec(html)?.[1]
				?.trim() ?? null,
		ids: Object.fromEntries(
			[
				...html.matchAll(
					/\/clients\/contacts\/([0-9a-f-]{36})"[^>]*>(?:\s|<!--[^>]*-->)*<span class="who[^"]*">(?:\s|<!--[^>]*-->)*<span class="n[^"]*">([^<]+)</g
				)
			].map((m) => [m[2].trim(), m[1]])
		)
	});
	const before = read(await clientPage());
	const was = before.bills ? before.ids[before.bills] : undefined;

	await check('a contact with no name is refused', 'POST', at, { name: ' ' }, 400);
	await check(
		'a contact whose email is not one is refused',
		'POST',
		at,
		{ name: first, email: 'not-an-email' },
		400
	);
	await check(
		'a contact whose phone is not one is refused',
		'POST',
		at,
		{ name: first, phone: 'call the office' },
		400
	);
	const billing = await check(
		'a contact is added to a client, and sent its invoices',
		'POST',
		at,
		{ name: first, email: 'Billing@Example.com', is_primary: true },
		201
	);
	const second = await check(
		'a second contact is added, and does not take the invoices',
		'POST',
		at,
		{ name: other, phone: '530 555 0100' },
		201
	);
	{
		const now = read(await clientPage());
		const ok =
			now.bills === first &&
			now.ids[first] === billing.body?.contact_id &&
			now.ids[other] === second.body?.contact_id;
		if (ok) passed++;
		else failures.push(`the client lists both, billing the first: ${JSON.stringify(now)}`);
		console.log(`  ${ok ? '✓' : '✗'} the client lists both, and the invoices go to the first`);
	}
	await check(
		'the invoices are given to the second',
		'POST',
		at,
		{ contact_id: second.body?.contact_id, is_primary: true },
		201
	);
	{
		const bills = read(await clientPage()).bills;
		const ok = bills === other;
		if (ok) passed++;
		else failures.push(`the invoices moved to the second: ${bills}`);
		console.log(`  ${ok ? '✓' : '✗'} and only the second gets them now`);
	}

	const person = `/api/contacts/${billing.body?.contact_id}`;
	await check(
		"a contact's email is changed on their page",
		'PATCH',
		person,
		{ fields: { email: 'Accounts@Example.com' } },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 && r.body?.saved?.email === 'accounts@example.com'
	);
	await check('and their phone', 'PATCH', person, { fields: { phone: '916-555-0100' } }, 200);
	await check(
		'an email that is not one is refused',
		'PATCH',
		person,
		{ fields: { email: 'accounts' } },
		400
	);
	await check('a name left empty is refused', 'PATCH', person, { fields: { name: '' } }, 400);
	await check(
		'one field at a time',
		'PATCH',
		person,
		{ fields: { phone: '916-555-0100', note: 'Two' } },
		400
	);
	await check(
		'a contact that does not exist is not found',
		'PATCH',
		'/api/contacts/01a1a81d-0000-7000-8000-000000000000',
		{ fields: { note: 'Nobody' } },
		404
	);
	{
		const html = await (
			await fetch(`${base}/clients/contacts/${billing.body?.contact_id}`, { headers: { cookie } })
		).text();
		const ok = html.includes('accounts@example.com') && html.includes('916-555-0100');
		if (ok) passed++;
		else failures.push("a contact's page shows what was changed");
		console.log(`  ${ok ? '✓' : '✗'} their page shows what was changed`);
	}

	if (was)
		await check(
			'who got the invoices before gets them again',
			'POST',
			at,
			{
				contact_id: was,
				is_primary: true
			},
			201
		);
}

await check(
	'a client is not exempt by a yes or no: an exemption is a state’s',
	'PATCH',
	`/api/clients/${clientSlug}`,
	{ fields: { tax_exempt: 'true' } },
	400
);
await check(
	'a client that does not exist is refused',
	'PATCH',
	'/api/clients/not-a-client',
	{ fields: { terms_days: '45' } },
	404
);

console.log('\n  one save must not erase another');
{
	// Both "pages" read the same version, as two people with the client open.
	const first = await call('PATCH', `/api/clients/${clientSlug}`, { fields: { terms_days: '60' } });
	const version = first.body?.version;
	if (!version) {
		failures.push('a save returned no version to condition the next one on');
	} else {
		const conditioned = async (/** @type {string} */ terms, /** @type {string} */ tag) => {
			const res = await fetch(base + `/api/clients/${clientSlug}`, {
				method: 'PATCH',
				headers: { ...H, 'if-match': `"${tag}"` },
				body: JSON.stringify({ fields: { terms_days: terms } })
			});
			let body = null;
			try {
				body = await res.json();
			} catch {
				/* empty */
			}
			return { status: res.status, body, etag: res.headers.get('etag') };
		};

		const a = await conditioned('28', version);
		const okA = a.status === 200 && a.etag;
		if (okA) passed++;
		else failures.push(`the first of two saves: ${a.status}`);
		console.log(`  ${okA ? '✓' : '✗'} the first save is taken, and hands back a new version`);

		// The second still holds the version from before A wrote.
		const b = await conditioned('35', version);
		const okB = refused('/problems/saved-since-read', 412)(b);
		if (okB) passed++;
		else failures.push(`a stale save was accepted: ${b.status}`);
		console.log(`  ${okB ? '✓' : '✗'} the second is refused rather than overwriting it`);

		const newVersion = a.etag?.replace(/"/g, '');
		if (!newVersion) failures.push('the taken save handed back no version to use next');
		const c = await conditioned('45', newVersion ?? '');
		const okC = c.status === 200;
		if (okC) passed++;
		else failures.push(`saving again with the new version: ${c.status}`);
		console.log(`  ${okC ? '✓' : '✗'} and is taken once it carries the current version`);
	}
}

// A site of its own, rather than one scraped off a page: the page builds its
// endpoint client-side so there is nothing in the HTML to read, and borrowing
// a real site means editing data somebody is looking at. Created, exercised,
// then closed.
//
// This is the one section that needs the network, because creating a site IS a
// CDTFA lookup. Unreachable is reported as skipped, not as a failure -- a
// check that goes red when the wifi drops gets ignored when it goes red for a
// reason.
{
	// A name of its own each run. Closing a site does not free its label or its
	// slug -- the row stays, because invoices point at it -- so a fixed name
	// makes this pass once and then collide for ever.
	const stamp = Date.now().toString(36);
	// An address is chosen from Google's suggestions and confirmed by Google
	// (8 October 2026): typed parts are refused, and so is a place Google did
	// not confirm -- here, with no key to ask by, any place at all.
	const typed = {
		label: `Write check ${stamp}`,
		street: '526 C St',
		city: 'Marysville',
		region: 'CA',
		postcode: '95901'
	};
	await check(
		'a site with an address typed rather than chosen is refused',
		'POST',
		`/api/clients/${clientSlug}/sites`,
		{ fields: typed },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 400 && /google/i.test(String(r.body?.errors?.google_place_id ?? ''))
	);
	const made = await call('POST', `/api/clients/${clientSlug}/sites`, {
		fields: { ...typed, google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }
	});

	if (made.status === 201) {
		passed++;
		console.log('  ✓ a site is created at a place Google confirms, and priced by CDTFA');
	} else if (made.status === 400 && made.body?.errors?.google_place_id) {
		passed++;
		console.log('  ✓ a place Google did not confirm is not a site');
	} else if (JSON.stringify(made.body).includes('CDTFA')) {
		console.log('  – site creation skipped: CDTFA could not be reached');
	} else {
		failures.push(`creating a site: ${made.status} ${JSON.stringify(made.body)?.slice(0, 140)}`);
		console.log('  ✗ a site is created, or refused, as its place is confirmed');
	}

	// A site the demo already has, put back as it was.
	const sitesPage = await (
		await fetch(`${base}/clients/${clientSlug}/sites`, { headers: { cookie } })
	).text();
	const existing =
		made.status === 201
			? made.body.slug
			: [...sitesPage.matchAll(new RegExp(`/clients/${clientSlug}/sites/([a-z0-9-]+)"`, 'g'))]
					.map((m) => m[1])
					.find((slug) => slug !== 'new');
	if (existing) {
		const at = `/api/clients/${clientSlug}/sites/${existing}`;
		const page = await (
			await fetch(`${base}/clients/${clientSlug}/sites/${existing}`, { headers: { cookie } })
		).text();
		const label = /<h1[^>]*>(?:\s|<!--[^>]*-->)*([^<]+?)\s*</.exec(page)?.[1];
		await check('a site renames', 'PATCH', at, { fields: { label: `Renamed ${stamp}` } }, 200);
		if (label) await check('and takes its own name back', 'PATCH', at, { fields: { label } }, 200);
		await check('a rate cannot be typed in', 'PATCH', at, { fields: { tax_rate_pct: '0' } }, 400);
		// Asked again from the site (7 November 2026): the answer goes into its
		// history whether or not the rate moved, and the site is dated as asked
		// today, so no warning that it is old is left. Skipped when CDTFA cannot be
		// reached, as creating a site is.
		const asked = await call('POST', `${at}/area`);
		if (asked.status === 200) {
			const after = await (
				await fetch(`${base}/clients/${clientSlug}/sites/${existing}/tax`, { headers: { cookie } })
			).text();
			// The newest answer in the history, which a run before this one cannot
			// have left.
			const newest = /id="history-h"[\s\S]*?class="sub[^"]*">([^<]*)</.exec(after)?.[1] ?? '';
			const ok =
				/^\d+\.\d{4}$/.test(String(asked.body?.rate)) &&
				newest.startsWith('Asked again') &&
				!after.includes('A district can start or end');
			if (ok) passed++;
			else
				failures.push(
					`asking CDTFA again: newest "${newest}", ${JSON.stringify(asked.body)?.slice(0, 120)}`
				);
			console.log(`  ${ok ? '✓' : '✗'} CDTFA is asked again from the site, and its answer kept`);
		} else if (asked.status === 502) {
			console.log('  – asking CDTFA again skipped: CDTFA could not be reached');
		} else {
			failures.push(
				`asking CDTFA again: ${asked.status} ${JSON.stringify(asked.body)?.slice(0, 120)}`
			);
			console.log('  ✗ CDTFA is asked again from the site, and its answer kept');
		}
		// The demo's sites carry Google's figures and none typed, so emptying
		// the typed one puts the site back as it was.
		await check(
			"a round trip is typed over Google's",
			'PATCH',
			at,
			{ fields: { typed_round_trip_miles: '12.5' } },
			(/** @type {{ status: number, body: any }} */ r) =>
				r.status === 200 && r.body?.saved?.typed_round_trip_miles === '12.5'
		);
		await check(
			"and emptied, so Google's is in force again",
			'PATCH',
			at,
			{ fields: { typed_round_trip_miles: '' } },
			(/** @type {{ status: number, body: any }} */ r) =>
				r.status === 200 && r.body?.saved?.typed_round_trip_miles === null
		);
		await check(
			"Google's own figure cannot be typed in",
			'PATCH',
			at,
			{ fields: { google_round_trip_miles: '1' } },
			400
		);
		await check(
			'a slug that leaves nothing is refused',
			'PATCH',
			at,
			{ fields: { slug: '!!!' } },
			400
		);
		await check(
			'part of an address on its own is refused: an address moves whole',
			'PATCH',
			at,
			{ fields: { street: '1001 D St' } },
			400
		);
		await check(
			'an address with a place Google did not confirm is refused',
			'PATCH',
			at,
			{ fields: { ...typed, label: undefined, google_place_id: 'not-a-place-at-all' } },
			400
		);
		if (otherSlug)
			await check(
				'the site is not reachable through another client',
				'PATCH',
				`/api/clients/${otherSlug}/sites/${existing}`,
				{ fields: { label: 'Should not work' } },
				404
			);
		// Harbor Light's front office, where the demo has Marcus answering first.
		// Added again without asking, he stays first; and is put back as he was
		// whatever happened.
		const office =
			'clients/harbor-light-dental/sites/4c42978a-ace1-4a79-a7f0-0d9e7efed2da/contacts';
		const marcus = 'd1bacc15-9d5f-4e64-9358-deac543219c0';
		await check(
			'someone at a site, added there again, is still on it',
			'POST',
			`/api/${office}`,
			{ contact_id: marcus },
			201
		);
		const there = await (await fetch(`${base}/${office}`, { headers: { cookie } })).text();
		const row = there.slice(there.indexOf(`contacts/${marcus}"`));
		const first = /class="lab acc[^"]*">Answers first/.exec(row)?.index ?? Infinity;
		const next = row.indexOf('class="box-row', 1);
		if (first < (next < 0 ? Infinity : next)) passed++;
		else
			failures.push(
				'someone answering first at a site, added again without it, stopped answering first'
			);
		console.log(
			`  ${first < (next < 0 ? Infinity : next) ? '✓' : '✗'} and still answers first, not having been asked otherwise`
		);
		await call('POST', `/api/${office}`, { contact_id: marcus, is_primary: true });
		if (made.status === 201) {
			await check(
				'somebody is added at the site',
				'POST',
				`${at}/contacts`,
				{ name: 'Write Check', is_primary: true },
				201
			);
			await check('the site closes', 'DELETE', at, undefined, 200);
		}
	} else failures.push(`no site of ${clientSlug} to change`);
}

// How far a place is, asked for on New site before anything is saved: Google's
// route there and back, or nothing and why. With no key, as here, it is the why.
console.log('\n  how far a place is, before it is a site');
await check(
	'a place is measured, or said why not',
	'POST',
	'/api/sites/drive',
	{ fields: { google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' } },
	(/** @type {{ status: number, body: any }} */ r) =>
		r.status === 200 &&
		(r.body?.why === null
			? r.body.google_round_trip_miles !== null && r.body.google_drive_minutes !== null
			: typeof r.body?.why === 'string' &&
				r.body.google_round_trip_miles === null &&
				r.body.google_drive_minutes === null)
);
await check(
	'a place not chosen from Google is refused',
	'POST',
	'/api/sites/drive',
	{ fields: { google_place_id: '' } },
	400
);

// The kinds of sale (#lib/server/sale-kinds): reckon's own, by which each is,
// and every one there is, as a state collected in answers them.
const kindsDb = new pg.Client(database());
await kindsDb.connect();
/** @type {Record<string, string>} */
const KIND = Object.fromEntries(
	(await kindsDb.query('select code, id from sale_kind where code is not null')).rows.map((r) => [
		r.code,
		r.id
	])
);
/** Every state the business collects in now, each answering `taxed`. */
const everyState = async (/** @type {boolean} */ taxed) =>
	Object.fromEntries(
		(await kindsDb.query('select state from tax_registration')).rows.map((r) => [r.state, taxed])
	);
/** Every kind there is now, each answered `taxed`. */
const everyKind = async (/** @type {boolean} */ taxed) =>
	Object.fromEntries(
		(await kindsDb.query('select id from sale_kind')).rows.map((r) => [r.id, taxed])
	);

console.log('\n  services — made, priced, and taken away again');

// Days far from today on purpose: the harness's clock and the database's can
// sit either side of midnight, and "today" or "yesterday" would then test the
// wrong rule.
const dayFrom = (/** @type {number} */ n) =>
	new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ahead = dayFrom(30);
const behind = dayFrom(-7);
const stamp = Date.now().toString(36);

await check(
	'a service with no name is refused',
	'POST',
	'/api/services',
	{
		fields: { name: '', unit: 'hour', sale_kind_id: KIND.repair },
		client_uuid: crypto.randomUUID()
	},
	400
);
await check(
	'a service that is no kind of sale is refused, said where',
	'POST',
	'/api/services',
	{ fields: { name: `Write check ${stamp}`, unit: 'hour' }, client_uuid: crypto.randomUUID() },
	(r) => r.status === 400 && Boolean(r.body?.errors?.sale_kind_id)
);
await check(
	'a service with no uuid it was added with is refused',
	'POST',
	'/api/services',
	{ fields: { name: `Write check ${stamp}`, unit: 'hour', sale_kind_id: KIND.repair } },
	400
);
const added = crypto.randomUUID();
const svc = await check(
	'a service is made',
	'POST',
	'/api/services',
	{
		fields: { name: `Write check ${stamp}`, unit: 'hour', sale_kind_id: KIND.repair },
		client_uuid: added
	},
	201
);
const sid = svc.body?.id;
await check(
	'sent twice, as a phone retrying would, it is the one service',
	'POST',
	'/api/services',
	{
		fields: { name: `Write check ${stamp}`, unit: 'hour', sale_kind_id: KIND.repair },
		client_uuid: added
	},
	(r) => r.status === 200 && r.body?.id === sid
);
if (sid) {
	const at = `/api/services/${sid}`;
	await check('it renames', 'PATCH', at, { fields: { name: `Checked ${stamp}` } }, 200);
	{
		// Its History keeps the rename, and who made it (0059).
		const page = await (
			await fetch(`${base}/catalogue/services/${sid}/history`, { headers: H })
		).text();
		const kept =
			page.includes(`Write check ${stamp}`) &&
			page.includes(`Checked ${stamp}`) &&
			page.includes('Changes, newest first');
		if (kept) passed++;
		else failures.push('its History keeps the rename: not found on the page');
		console.log(`  ${kept ? '✓' : '✗'} its History keeps the rename`);
	}
	await check(
		'moving it off hours clears its increment',
		'PATCH',
		at,
		{ fields: { unit: 'each' } },
		(r) => r.status === 200 && r.body?.saved?.bill_to_nearest_seconds === null
	);
	await check(
		'an increment on a flat rate is refused',
		'PATCH',
		at,
		{ fields: { bill_to_nearest_seconds: '60' } },
		400
	);
	await check(
		'back to hours, billed to the minute',
		'PATCH',
		at,
		{ fields: { unit: 'hour' } },
		(r) => r.status === 200 && r.body?.saved?.bill_to_nearest_seconds === 60
	);

	const prices = `${at}/prices`;
	await check(
		'a price on a day that does not exist is refused',
		'POST',
		prices,
		{ fields: { rate: '60.00', effective_from: '2026-02-30' } },
		400
	);
	await check(
		'a price from a week ago saves',
		'POST',
		prices,
		{ fields: { rate: '60.00', effective_from: behind } },
		201
	);
	await check(
		'that day has passed, so it is not rewritten',
		'POST',
		prices,
		{ fields: { rate: '61.00', effective_from: behind } },
		400
	);
	const next = await check(
		'a price scheduled a month out saves',
		'POST',
		prices,
		{ fields: { rate: '70.00', additional_rate: '40.00', effective_from: ahead } },
		201
	);
	await check(
		'and is corrected, not doubled, before its day',
		'POST',
		prices,
		{ fields: { rate: '72.00', effective_from: ahead } },
		(r) => r.status === 200 && r.body?.replaced === true && r.body?.id === next.body?.id
	);
	if (next.body?.id)
		await check(
			'a scheduled price is taken back',
			'DELETE',
			`${prices}/${next.body.id}`,
			undefined,
			200
		);

	const rules = `${at}/rules`;
	const nobody = '00000000-0000-0000-0000-000000000000';
	await check(
		'a rule paying nobody is refused',
		'POST',
		rules,
		{ fields: { pays_for: 'time', method: 'per_hour', amount: '30', effective_from: ahead } },
		400
	);
	await check(
		'a rule paying a role and a person is refused',
		'POST',
		rules,
		{
			fields: {
				role_id: nobody,
				user_id: nobody,
				pays_for: 'time',
				method: 'per_hour',
				amount: '30',
				effective_from: ahead
			}
		},
		400
	);
	await check(
		'retainer time paid by the hour is refused',
		'POST',
		rules,
		{
			fields: {
				role_id: nobody,
				pays_for: 'covered_time',
				method: 'per_hour',
				amount: '30',
				effective_from: ahead
			}
		},
		400
	);
	await check(
		'a rule for a role that does not exist is refused',
		'POST',
		rules,
		{
			fields: {
				role_id: nobody,
				pays_for: 'time',
				method: 'per_hour',
				amount: '30',
				effective_from: ahead
			}
		},
		400
	);

	// With time recorded under it, it is refused in words, not as a server
	// error -- and only the check's own service and entry are touched.
	const hour = await call('POST', '/api/time', {
		...entry,
		service_id: sid,
		crew: 'team',
		worked_by: null,
		client_uuid: crypto.randomUUID()
	});
	if (hour.body?.id) {
		await check(
			'a service with time recorded is not removed, as things stand',
			'DELETE',
			at,
			undefined,
			refused(AS_IT_STANDS)
		);
		await check('its entry goes', 'DELETE', `/api/time/${hour.body.id}?version=1`, undefined, 200);
	}
	await check('a service nothing used is removed', 'DELETE', at, undefined, 200);
}
console.log('\n  agreements — made, covered, and taken away again');

const newAgreement = await (
	await fetch(`${base}/catalogue/agreements/new`, { headers: { cookie } })
).text();
const agreeWith = optionsOf(newAgreement, 'a-client')[0]?.id;
// A year out, so the agreement this makes cannot cover anything already worked.
const yearOut = dayFrom(400);
const terms = {
	entity_id: agreeWith,
	price: '150.00',
	billing_interval: 'monthly',
	starts_on: yearOut
};

await check(
	'an agreement with no price is refused',
	'POST',
	'/api/agreements',
	{ fields: { ...terms, price: '' } },
	400
);
await check(
	'an agreement for a site that is not the client’s is refused',
	'POST',
	'/api/agreements',
	{ fields: { ...terms, site_id: '00000000-0000-0000-0000-000000000000' } },
	400
);
const made = agreeWith
	? await check(
			'an agreement for the whole client is made',
			'POST',
			'/api/agreements',
			{ fields: terms },
			201
		)
	: null;
const aid = made?.body?.id;
if (aid) {
	const at = `/api/agreements/${aid}`;
	await check('its price changes', 'PATCH', at, { fields: { price: '175.00' } }, 200);
	await check(
		'it cannot end before it starts',
		'PATCH',
		at,
		{ fields: { ends_on: dayFrom(390) } },
		400
	);
	await check(
		'a contact who is not the client’s is refused',
		'PATCH',
		at,
		{ fields: { contact_id: '00000000-0000-0000-0000-000000000000' } },
		400
	);

	const listed = await (await fetch(`${base}/catalogue/services`, { headers: { cookie } })).text();
	const service = [...listed.matchAll(/\/catalogue\/services\/([0-9a-f-]{36})"/g)].map(
		(m) => m[1]
	)[0];
	if (service) {
		const cover = `${at}/coverage/${service}`;
		await check(
			'a cap with no hours is refused',
			'PUT',
			cover,
			{ fields: { allotment: 'capped', overage: 'bill' } },
			400
		);
		await check(
			'a service is covered, unlimited',
			'PUT',
			cover,
			{ fields: { allotment: 'unlimited', included: '9' } },
			(r) => r.status === 200 && r.body?.saved?.included === null
		);
		await check(
			'and changed to a cap, whole',
			'PUT',
			cover,
			{ fields: { allotment: 'capped', included: '6', overage: 'no_charge' } },
			200
		);
		// Another for the whole client, from the same day, would leave nothing to
		// choose between them for an hour of it, so it cannot cover it too.
		const twin = (await call('POST', '/api/agreements', { fields: terms })).body?.id;
		if (twin) {
			const other = `/api/agreements/${twin}`;
			await check(
				'a second agreement for the whole client, from the same day, cannot cover it too, and says which does',
				'PUT',
				`${other}/coverage/${service}`,
				{ fields: { allotment: 'unlimited' } },
				(r) =>
					r.status === 400 &&
					/other agreement for the whole client/.test(r.body?.errors?.service ?? '')
			);
			await check(
				'from the next day it can',
				'PATCH',
				other,
				{ fields: { starts_on: dayFrom(401) } },
				200
			);
			await check(
				'and covers it',
				'PUT',
				`${other}/coverage/${service}`,
				{ fields: { allotment: 'unlimited' } },
				200
			);
			await check(
				'but its start cannot move onto the day the other starts',
				'PATCH',
				other,
				{ fields: { starts_on: yearOut } },
				(r) =>
					r.status === 400 && /starts that day and covers/.test(r.body?.errors?.starts_on ?? '')
			);
			await check('the second is removed', 'DELETE', other, undefined, 200);
		}
		await check('and no longer covered', 'DELETE', cover, undefined, 200);
		await check('which cannot happen twice', 'DELETE', cover, undefined, 404);
	}
	await check('an agreement nothing was charged under is removed', 'DELETE', at, undefined, 200);
}

console.log('\n  roles — named, said what they pay, renamed, and taken away again');

await check(
	'a role with no name is refused',
	'POST',
	'/api/roles',
	{ fields: { name: '  ', pays_as: 'wages' } },
	400
);
await check(
	'a role that does not say what it is paid as is refused',
	'POST',
	'/api/roles',
	{ fields: { name: `Check ${stamp}` } },
	400
);
await check(
	'a role paid as something not on the list is refused',
	'POST',
	'/api/roles',
	{ fields: { name: `Check ${stamp}`, pays_as: 'salary' } },
	400
);
const role = await check(
	'a role is added',
	'POST',
	'/api/roles',
	{ fields: { name: `Check ${stamp}`, pays_as: 'wages' } },
	201
);
await check(
	'the same name twice is refused',
	'POST',
	'/api/roles',
	{ fields: { name: `Check ${stamp}`, pays_as: 'wages' } },
	400
);
if (role.body?.id) {
	await check(
		'it renames',
		'PATCH',
		`/api/roles/${role.body.id}`,
		{ fields: { name: `Checked ${stamp}` } },
		200
	);
	await check(
		'what it is paid as changes',
		'PATCH',
		`/api/roles/${role.body.id}`,
		{ fields: { pays_as: 'fee' } },
		200
	);
	await check(
		'it cannot go back to not saying',
		'PATCH',
		`/api/roles/${role.body.id}`,
		{ fields: { pays_as: '' } },
		400
	);
	await check(
		'two fields at once are refused, as a setting saves one',
		'PATCH',
		`/api/roles/${role.body.id}`,
		{ fields: { name: `Both ${stamp}`, pays_as: 'wages' } },
		400
	);
	await check(
		'a role nobody holds is removed',
		'DELETE',
		`/api/roles/${role.body.id}`,
		undefined,
		200
	);
}
// Team lists everyone, a row each opening their page; a page offers each role.
const teamPage = await (await fetch(`${base}/team`, { headers: { cookie } })).text();
const teamRows = teamPage.split('class="box-row').slice(1);
const idOf = (/** @type {string} */ row) => /team\/([0-9a-f-]{36})"/.exec(row)?.[1];
const myId = idOf(teamRows.find((r) => r.includes(email)) ?? '');
const otherId = teamRows.map(idOf).find((id) => id && id !== myId);
const person = teamRows.map(idOf).find(Boolean);
const personPage = person
	? await (await fetch(`${base}/team/${person}`, { headers: { cookie } })).text()
	: '';
const held = [
	...personPage.matchAll(
		/name="role" value="([0-9a-f-]{36})"[\s\S]{0,400}?class="rad-t[^"]*">([^<]+)</g
	)
]
	.map((m) => ({ id: m[1], label: m[2].trim() }))
	.find((o) => o.label === 'Partner');
if (held)
	await check(
		'a role somebody holds is not removed',
		'DELETE',
		`/api/roles/${held.id}`,
		undefined,
		409
	);
if (person)
	await check(
		'a person cannot be given a role that does not exist',
		'PATCH',
		`/api/people/${person}`,
		{ fields: { role_id: '00000000-0000-0000-0000-000000000000' } },
		400
	);

console.log('\n  retainers — metered over a period of their own');
{
	/** The text of some markup: what lies between its tags, one space apart. */
	const textOf = (/** @type {string} */ html) =>
		[...html.matchAll(/>([^<]*)/g)]
			.map((m) => m[1])
			.join(' ')
			.replace(/\s+/g, ' ');
	/** The text of a page's row that names `who`. */
	const rowOf = async (/** @type {string} */ path, /** @type {string} */ who) =>
		textOf(
			(await (await fetch(`${base}${path}`, { headers: { cookie } })).text())
				.split('class="box-row')
				.find((r) => r.includes(who)) ?? ''
		);
	const form = await (
		await fetch(`${base}/catalogue/agreements/new`, { headers: { cookie } })
	).text();
	const today = /id="a-starts"[^>]*?value="(\d{4}-\d{2}-\d{2})"/.exec(form)?.[1];
	// A client with no agreement of its own, so this one takes no hours from another.
	const pinecrest = optionsOf(form, 'a-client').find((c) => c.label === 'Pinecrest Insurance')?.id;
	const helpDesk = optionsOf(manual, 'm-service').find((x) => x.label === 'Help desk')?.id;
	if (!today || !pinecrest || !helpDesk || !myId) {
		failures.push(`retainers: nothing to meter with (${today} ${pinecrest} ${helpDesk} ${myId})`);
	} else {
		// A quarter from the first of last month: last month, this one, and the next.
		const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
		const lastMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
		const made = await check(
			'a quarterly agreement is made from the first of last month',
			'POST',
			'/api/agreements',
			{
				fields: {
					entity_id: pinecrest,
					price: '300.00',
					billing_interval: 'quarterly',
					starts_on: lastMonth
				}
			},
			201
		);
		const quarter = made.body?.id;
		await check(
			'covering six hours of help desk a quarter',
			'PUT',
			`/api/agreements/${quarter}/coverage/${helpDesk}`,
			{ fields: { allotment: 'capped', included: '6', overage: 'bill' } },
			200
		);
		for (const [worked_on, minutes] of /** @type {[string, number][]} */ ([
			[`${lastMonth.slice(0, 8)}15`, 60],
			[`${today.slice(0, 8)}01`, 90]
		]))
			await check(
				`${minutes} minutes of help desk on ${worked_on} falls under it`,
				'POST',
				'/api/time',
				{
					...entry,
					client_uuid: crypto.randomUUID(),
					worked_on,
					minutes,
					worked_by: myId,
					entity_id: pinecrest,
					service_id: helpDesk,
					note: 'write-check: a quarter metered whole'
				},
				200
			);

		const metered = await rowOf('/reports/retainers', 'Pinecrest Insurance');
		const said = (
			/** @type {boolean} */ ok,
			/** @type {string} */ label,
			/** @type {string} */ got
		) => {
			if (ok) passed++;
			else failures.push(`${label}: ${got}`);
			console.log(`  ${ok ? '✓' : '✗'} ${label}`);
		};
		said(
			metered.includes('2.50 hr used of 6.00 hr · 3.50 hr left') &&
				metered.includes('so far') &&
				metered.includes('Not charged yet'),
			'the meter reads both months against the quarter’s six hours, so far, not charged yet',
			metered
		);
		said(
			!(await rowOf('/reports/retainers?period=last', 'Pinecrest Insurance')),
			'and has no period just closed for it: its first is under way',
			'a row for it under Last period'
		);
		const listed = await rowOf('/catalogue/agreements', 'Pinecrest Insurance');
		const running = await (
			await fetch(`${base}/catalogue/agreements`, { headers: { cookie } })
		).text();
		const head = (running.split('id="running-h"')[1] ?? '').split('class="box-row')[0];
		said(
			listed.includes('Help desk · 2.50 hr used this quarter of 6.00 hr') &&
				listed.includes('$300.00 a quarter') &&
				textOf(head).includes('$300.00 a quarter'),
			'the catalogue says the quarter’s use, and counts its charge as a quarter’s',
			`${listed} | ${textOf(head)}`
		);
		const overview = await rowOf('/clients/pinecrest-insurance', '$300.00');
		said(
			overview.includes('This quarter: Help desk 2.50 hr of 6.00 hr') &&
				overview.includes('a quarter'),
			'and so does the client’s Overview',
			overview
		);
		await check('the agreement is removed', 'DELETE', `/api/agreements/${quarter}`, undefined, 200);
	}
}

console.log('\n  retainers — a cap counts what its service charges by');
{
	const textOf = (/** @type {string} */ html) =>
		[...html.matchAll(/>([^<]*)/g)]
			.map((m) => m[1])
			.join(' ')
			.replace(/\s+/g, ' ');
	const rowOf = async (/** @type {string} */ path, /** @type {string} */ who) =>
		textOf(
			(await (await fetch(`${base}${path}`, { headers: { cookie } })).text())
				.split('class="box-row')
				.find((r) => r.includes(who)) ?? ''
		);
	const said = (
		/** @type {boolean} */ ok,
		/** @type {string} */ label,
		/** @type {string} */ got
	) => {
		if (ok) passed++;
		else failures.push(`${label}: ${got}`);
		console.log(`  ${ok ? '✓' : '✗'} ${label}`);
	};
	const form = await (
		await fetch(`${base}/catalogue/agreements/new`, { headers: { cookie } })
	).text();
	const today = /id="a-starts"[^>]*?value="(\d{4}-\d{2}-\d{2})"/.exec(form)?.[1];
	// A client with no agreement of its own, so this one takes nothing from another.
	const marisol = optionsOf(form, 'a-client').find((c) => c.label === 'Marisol Vega')?.id;
	const services = optionsOf(manual, 'm-service');
	const assessment = services.find((x) => x.label === 'Network assessment')?.id;
	const field = services.find((x) => x.label === 'Field service')?.id;
	if (!today || !marisol || !assessment || !field || !myId) {
		failures.push(`a flat-rate cap: nothing to cap (${today} ${marisol} ${assessment} ${field})`);
	} else {
		const made = await check(
			'a monthly agreement is made from the first of this month',
			'POST',
			'/api/agreements',
			{
				fields: {
					entity_id: marisol,
					price: '250.00',
					billing_interval: 'monthly',
					starts_on: `${today.slice(0, 8)}01`
				}
			},
			201
		);
		const month = made.body?.id;
		const cover = `/api/agreements/${month}/coverage`;
		await check(
			'a network assessment, a flat charge, cannot be capped at two and a half',
			'PUT',
			`${cover}/${assessment}`,
			{ fields: { allotment: 'capped', included: '2.5', overage: 'bill' } },
			(r) => r.status === 400 && /whole number of times/.test(r.body?.errors?.included ?? '')
		);
		await check(
			'but at two',
			'PUT',
			`${cover}/${assessment}`,
			{ fields: { allotment: 'capped', included: '2', overage: 'bill' } },
			200
		);
		await check(
			'field service, by the hour, at an hour and a half',
			'PUT',
			`${cover}/${field}`,
			{ fields: { allotment: 'capped', included: '1.5', overage: 'bill' } },
			200
		);
		const moved = await check(
			'and so cannot be moved to a flat charge, which would be included by how many',
			'PATCH',
			`/api/services/${field}`,
			{ fields: { unit: 'each' } },
			(r) => r.status === 400 && /part of an hour/.test(r.body?.errors?.unit ?? '')
		);
		// Put back, should the move have gone through: the checks after are by the hour.
		if (moved.status === 200)
			await call('PATCH', `/api/services/${field}`, {
				fields: { unit: 'hour', bill_to_nearest_seconds: '60' }
			});
		for (const minutes of [90, 45, 60])
			await check(
				`a ${minutes}-minute network assessment falls under it`,
				'POST',
				'/api/time',
				{
					...entry,
					client_uuid: crypto.randomUUID(),
					worked_on: today,
					minutes,
					billable: true,
					worked_by: myId,
					entity_id: marisol,
					service_id: assessment,
					note: 'write-check: a flat-rate cap'
				},
				200
			);

		const metered = await rowOf('/reports/retainers', 'Marisol Vega');
		said(
			metered.includes('Network assessment') &&
				metered.includes('3 times used of 2 times · 0 times left'),
			'the meter counts the assessments, not their hours',
			metered
		);
		const listed = await rowOf('/catalogue/agreements', 'Marisol Vega');
		said(
			listed.includes('Network assessment · 3 times used this month of 2 times') &&
				listed.includes('Field service · 0.00 hr used this month of 1.50 hr'),
			'and so does the catalogue, field service still in hours',
			listed
		);
		const overview = await rowOf('/clients/marisol-vega', '$250.00');
		said(
			overview.includes('Network assessment 3 times of 2 times'),
			'and the client’s Overview',
			overview
		);
		await check('the agreement is removed', 'DELETE', `/api/agreements/${month}`, undefined, 200);
	}
}

console.log('\n  people — who they are, and whether they sign in');

if (myId && otherId) {
	const theirs = teamRows.find((r) => r.includes(`team/${otherId}"`)) ?? '';
	const otherEmail = /class="e[^"]*">([^<]+)</.exec(theirs)?.[1]?.trim();
	const otherName = /class="n[^"]*">([^<]+)</.exec(theirs)?.[1]?.trim();
	const them = `/api/people/${otherId}`;
	await check('a person needs a name', 'PATCH', them, { fields: { name: '  ' } }, 400);
	await check('an email is one', 'PATCH', them, { fields: { email: 'not-an-email' } }, 400);
	if (otherEmail)
		await check(
			'nobody signs in with the email someone else does',
			'PATCH',
			`/api/people/${myId}`,
			{ fields: { email: otherEmail } },
			400
		);
	if (otherName) {
		await check('a person is renamed', 'PATCH', them, { fields: { name: `${otherName} B` } }, 200);
		await check('and named back', 'PATCH', them, { fields: { name: otherName } }, 200);
	}
	await check(
		'nobody deactivates themselves',
		'PATCH',
		`/api/people/${myId}`,
		{ fields: { active: 'false' } },
		400
	);
	await check(
		'someone else is not deactivated without a reason, which they are emailed',
		'PATCH',
		them,
		{ fields: { active: 'false' } },
		400
	);
	await check(
		'someone else is deactivated, with why',
		'PATCH',
		them,
		{ fields: { active: 'false' }, reason: 'Checking a deactivation works' },
		200
	);
	await check('and reactivated', 'PATCH', them, { fields: { active: 'true' } }, 200);
} else {
	failures.push('could not find who is signed in, and someone else, on /team');
	console.log('  ✗ could not find who is signed in, and someone else, on /team');
}

console.log('\n  trips — recorded, sent twice, refused, and taken back');

// Two clients from New agreement. The stop is an address, for the first: a site
// would need an id no page here writes down, and the guard suite proves a
// client's stop is at their own site.
const otherClient = optionsOf(newAgreement, 'a-client')[1]?.id;
if (agreeWith && otherClient && person) {
	const stopAt = (/** @type {string} */ entity) => [
		{ address: 'Write check yard', clients: [{ entity_id: entity, asked_there: false }] }
	];
	const outAndBack = {
		client_uuid: crypto.randomUUID(),
		travelled_on: new Date().toISOString().slice(0, 10),
		driven_by: person,
		vehicle_id: null,
		stops: stopAt(agreeWith),
		drives: [{ miles: '12.5' }, { miles: '12.5' }]
	};
	const again = () => ({ ...outAndBack, client_uuid: crypto.randomUUID() });
	const trip = await check('a trip is recorded', 'POST', '/api/trips', outAndBack, 201);
	await check(
		'the same trip sent again is not a second one',
		'POST',
		'/api/trips',
		outAndBack,
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 && r.body?.id === trip.body?.id
	);
	if (trip.body?.id) {
		await check(
			'a trip is changed, its legs worked out again',
			'PUT',
			`/api/trips/${trip.body.id}`,
			{
				...outAndBack,
				note: 'Changed by write-check',
				drives: [{ miles: '12.5' }, { miles: '13' }]
			},
			(/** @type {{ status: number, body: any }} */ r) =>
				r.status === 200 && r.body?.id === trip.body?.id
		);
		await check(
			'a change that leaves a drive out is refused',
			'PUT',
			`/api/trips/${trip.body.id}`,
			{ ...outAndBack, drives: [{ miles: '12.5' }] },
			400
		);
	}
	await check(
		'a trip that does not exist is not changed',
		'PUT',
		`/api/trips/${crypto.randomUUID()}`,
		again(),
		404
	);
	await check(
		'a trip missing a drive is refused',
		'POST',
		'/api/trips',
		{ ...again(), drives: [{ miles: '12.5' }] },
		400
	);
	await check(
		'a trip on a day that does not exist is refused, as that day',
		'POST',
		'/api/trips',
		{ ...again(), travelled_on: '2026-02-30' },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 400 && Object.keys(r.body?.errors ?? {}).join() === 'travelled_on'
	);
	await check(
		'a payment on a day that does not exist is refused, as that day',
		'POST',
		'/api/pay',
		{
			client_uuid: crypto.randomUUID(),
			user_id: person,
			paid_on: '2026-02-30',
			how: 'cash',
			entries: [crypto.randomUUID()]
		},
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 400 && Object.keys(r.body?.errors ?? {}).join() === 'paid_on'
	);
	await check(
		'an odometer that reads backwards is refused',
		'POST',
		'/api/trips',
		{ ...again(), odometer_start: '48270', odometer_end: '48213' },
		400
	);
	await check(
		'a stop that is nowhere is refused',
		'POST',
		'/api/trips',
		{ ...again(), stops: [{ clients: [] }] },
		400
	);
	await check(
		'a drive given to somebody the trip was not for is refused',
		'POST',
		'/api/trips',
		{ ...again(), drives: [{ miles: '12.5', to: [otherClient] }, { miles: '12.5' }] },
		400
	);
	await check(
		"a trip's route is asked for, and answers with miles or nothing",
		'POST',
		'/api/trips/route',
		{ stops: stopAt(agreeWith) },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 &&
			(r.body?.miles === null || (Array.isArray(r.body?.miles) && r.body.miles.length === 2))
	);
	await check(
		'a route with a stop that is nowhere is refused',
		'POST',
		'/api/trips/route',
		{ stops: [{}] },
		400
	);
	await check(
		'what a trip comes to is worked out before it is saved',
		'POST',
		'/api/trips/worth',
		again(),
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 && typeof r.body?.billed === 'string'
	);
	if (trip.body?.id)
		await check(
			'a trip whose miles are not billed is taken back',
			'DELETE',
			`/api/trips/${trip.body.id}`,
			undefined,
			200
		);
} else failures.push('could not find two clients and a person for a trip');
// The demo's visit forty days ago, whose miles are on an invoice: named by the
// seed's own id rather than found by its month, since which month forty days ago
// falls in depends on whose clock -- the database's runs at UTC+14 here.
const billedTrip = '57bd5f26-036a-4487-af85-2e9e2ac26c38';
const billedPage = await fetch(`${base}/trips/${billedTrip}`, { headers: { cookie } });
if (billedPage.ok) {
	await check(
		'a trip whose miles are on an invoice stays',
		'DELETE',
		`/api/trips/${billedTrip}`,
		undefined,
		409
	);
	if (agreeWith && person)
		await check(
			'a trip whose miles are on an invoice is not changed',
			'PUT',
			`/api/trips/${billedTrip}`,
			{
				client_uuid: crypto.randomUUID(),
				travelled_on: new Date().toISOString().slice(0, 10),
				driven_by: person,
				stops: [{ address: 'Write check yard', clients: [{ entity_id: agreeWith }] }],
				drives: [{ miles: '1' }, { miles: '1' }]
			},
			409
		);
} else failures.push(`the demo's billed trip did not open: ${billedPage.status}`);

console.log(
	'\n  pay — recorded once, never less than nothing, never for somebody else, each part as it paid'
);

// Who is owed, from the pay report; Sam's earlier payment, from Sam's Paid tab.
const payPage = await (await fetch(`${base}/reports/pay`, { headers: { cookie } })).text();
const payee = (/** @type {string} */ name) =>
	[
		...payPage.matchAll(
			/href="[^"]*\/reports\/pay\/([0-9a-f-]{36})"[\s\S]*?class="n[^"]*">(?:\s|<!--[^>]*-->)*([^<&]+)/g
		)
	].find((m) => m[2].trim() === name)?.[1];
const sam = payee('Sam Ortega');
const avery = payee('Avery Lind');
const samPage = sam
	? await (await fetch(`${base}/reports/pay/${sam}/paid`, { headers: { cookie } })).text()
	: '';
const samPaid = /\/reports\/pay\/payments\/([0-9a-f-]{36})"/.exec(samPage)?.[1];
if (sam && avery && samPaid) {
	const payment = (/** @type {Record<string, unknown>} */ over) => ({
		client_uuid: crypto.randomUUID(),
		user_id: sam,
		// Yesterday on UTC's clock: never in the business's future, and after Sam's
		// payment three weeks ago, whatever clocks the run is under.
		paid_on: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
		how: 'Bank transfer',
		entries: [],
		trips: [],
		correction: null,
		...over
	});
	await check('a payment covering nothing is refused', 'POST', '/api/pay', payment({}), 400);
	await check(
		'a payment for work that is not owed is refused',
		'POST',
		'/api/pay',
		payment({ entries: [crypto.randomUUID()] }),
		409
	);
	await check(
		"a correction to somebody else's payment is refused",
		'POST',
		'/api/pay',
		payment({
			user_id: avery,
			correction: { payment_id: samPaid, paid_as: 'wages', amount: '1.00', why: 'Not theirs' }
		}),
		400
	);
	await check(
		'a payment that would come to less than nothing is refused',
		'POST',
		'/api/pay',
		payment({
			correction: { payment_id: samPaid, paid_as: 'wages', amount: '-1000.00', why: 'Too much' }
		}),
		400
	);
	await check(
		'a correction that does not say which part it corrects is refused',
		'POST',
		'/api/pay',
		payment({ correction: { payment_id: samPaid, amount: '1.00', why: 'Which part?' } }),
		400
	);
	await check(
		'a correction to a part that payment did not pay is refused',
		'POST',
		'/api/pay',
		payment({
			correction: {
				payment_id: samPaid,
				paid_as: 'reimbursement',
				amount: '1.00',
				why: 'Miles it never paid'
			}
		}),
		400
	);
	const short = payment({
		correction: {
			payment_id: samPaid,
			paid_as: 'wages',
			amount: '1.00',
			why: 'Paid a dollar short'
		}
	});
	const corrected = await check('a correction alone is recorded', 'POST', '/api/pay', short, 201);
	await check(
		'the same payment sent again is one payment',
		'POST',
		'/api/pay',
		short,
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 && r.body?.id === corrected.body?.id
	);
} else failures.push("could not find Sam, Avery and Sam's earlier payment on the pay pages");

console.log('\n  units — named, written, counted, and let go');

await check(
	'a unit with no name is refused',
	'POST',
	'/api/units',
	{ fields: { name: ' ', places: '0' } },
	400
);
await check(
	'more places than a quantity holds is refused',
	'POST',
	'/api/units',
	{ fields: { name: `grain ${stamp}`, places: '5' } },
	400
);
const gallon = await check(
	'a unit is added',
	'POST',
	'/api/units',
	{ fields: { name: `gallon ${stamp}`, short: 'gal', places: '2' } },
	201
);
await check(
	'the same name twice is refused',
	'POST',
	'/api/units',
	{ fields: { name: `gallon ${stamp}`, places: '0' } },
	400
);
if (gallon.body?.id) {
	await check(
		'its places change',
		'PATCH',
		`/api/units/${gallon.body.id}`,
		{ fields: { places: '1' } },
		(/** @type {{ status: number, body: any }} */ r) =>
			r.status === 200 && r.body?.saved?.places === 1
	);
	await check(
		'a unit nothing is counted in is removed',
		'DELETE',
		`/api/units/${gallon.body.id}`,
		undefined,
		200
	);
}
// The foot, which the demo's raceway is counted in.
const unitsPage = await (await fetch(`${base}/settings/units`, { headers: { cookie } })).text();
const foot = [
	...unitsPage.matchAll(
		/id="unit-([0-9a-f-]{36})"[\s\S]*?class="n[^"]*">(?:\s|<!--[^>]*-->)*([^<]+)</g
	)
].find((m) => m[2].trim() === 'foot')?.[1];
if (foot)
	await check(
		'a unit stock is counted in is not removed',
		'DELETE',
		`/api/units/${foot}`,
		undefined,
		409
	);
else failures.push('could not find the foot on /settings/units');

console.log('\n  vehicles — whose, renamed, retired, and let go');

await check(
	'a vehicle with no name is refused',
	'POST',
	'/api/vehicles',
	{ fields: { name: ' ', owner_id: '' } },
	400
);
await check(
	'a vehicle owned by nobody known is refused',
	'POST',
	'/api/vehicles',
	{ fields: { name: `Ghost ${stamp}`, owner_id: crypto.randomUUID() } },
	400
);
const van = await check(
	"the business's vehicle is added",
	'POST',
	'/api/vehicles',
	{ fields: { name: `Van ${stamp}`, owner_id: '' } },
	201
);
if (van.body?.id) {
	await check(
		'it is renamed',
		'PATCH',
		`/api/vehicles/${van.body.id}`,
		{ fields: { name: `Box van ${stamp}` } },
		200
	);
	await check(
		'whose it is is not changed',
		'PATCH',
		`/api/vehicles/${van.body.id}`,
		{ fields: { owner_id: crypto.randomUUID() } },
		400
	);
	await check(
		'it is retired',
		'PATCH',
		`/api/vehicles/${van.body.id}`,
		{ fields: { retired: 'true' } },
		200
	);
	await check(
		'a vehicle never driven is removed',
		'DELETE',
		`/api/vehicles/${van.body.id}`,
		undefined,
		200
	);
}
// The Corolla, which the demo's trip today was driven in.
const vehiclesPage = await (
	await fetch(`${base}/settings/vehicles`, { headers: { cookie } })
).text();
const corolla = [
	...vehiclesPage.matchAll(
		/href="[^"]*\/settings\/vehicles\/([0-9a-f-]{36})"[\s\S]*?class="n[^"]*">(?:\s|<!--[^>]*-->)*([^<&]+)/g
	)
].find((m) => m[2].trim() === 'Corolla')?.[1];
if (corolla)
	await check(
		'a vehicle a trip was driven in is not removed',
		'DELETE',
		`/api/vehicles/${corolla}`,
		undefined,
		409
	);
else failures.push('could not find the Corolla on /settings/vehicles');

// An SVG logo with a script in it, uploaded through the settings form the way
// a browser would, and then asked for by someone who is not signed in. It is
// still served as an image -- the favicon and the installed icon depend on
// that -- but under a policy that runs nothing if it is opened as a page.
{
	const svg =
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>';
	const form = new FormData();
	form.set('logo', new Blob([svg], { type: 'image/svg+xml' }), 'logo.svg');
	const up = await fetch(`${base}/settings/brand?/logo`, {
		method: 'POST',
		body: form,
		headers: { cookie, origin: base, 'x-sveltekit-action': 'true', ...PROXY }
	});
	const served = await fetch(`${base}/operator/logo`, { headers: PROXY });
	const policy = served.headers.get('content-security-policy') ?? '';
	const ok =
		up.ok &&
		served.status === 200 &&
		served.headers.get('content-type') === 'image/svg+xml' &&
		/default-src 'none'/.test(policy) &&
		/(^|;\s*)sandbox(;|$)/.test(policy) &&
		!/script-src/.test(policy);
	if (ok) passed++;
	else
		failures.push(
			`an SVG logo is served under a policy that runs nothing: ${up.status} ${served.status} ${policy || 'no policy'}`
		);
	console.log(`  ${ok ? '✓' : '✗'} an SVG logo is served under a policy that runs nothing`);

	// The demo business has no logo; it is left without one.
	await fetch(`${base}/settings/brand?/clearLogo`, {
		method: 'POST',
		body: new FormData(),
		headers: { cookie, origin: base, 'x-sveltekit-action': 'true', ...PROXY }
	});
}

/** What a detail of this name holds, as the server drew it (#lib/Detail). */
const detailHeld = (/** @type {string} */ html, /** @type {string} */ name) =>
	new RegExp(`data-detail="${name}" data-value="([^"]*)"`).exec(html)?.[1] ?? null;

// Two clocks (#26). The server works in UTC. A person's own today -- their
// timesheet, the day a new entry starts on -- follows the zone on their user
// record. The business's today -- overdue, ageing, report months -- follows the
// operator's zone, the same for everyone. Kiritimati and Pago Pago are 25 hours
// apart: at any moment they sit on different dates, and their clocks read an
// hour apart.
{
	const zoneDay = (/** @type {string} */ zone) =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date());
	const page = async (/** @type {string} */ path) =>
		(await fetch(base + path, { headers: { cookie } })).text();
	/** @param {boolean} ok @param {string} label @param {string} detail */
	const record = (ok, label, detail) => {
		if (ok) passed++;
		else failures.push(`${label}: ${detail}`);
		console.log(`  ${ok ? '✓' : '✗'} ${label}`);
	};
	const formDay = async () =>
		/id="m-day"[^>]*?max="(\d{4}-\d{2}-\d{2})"/.exec(await page('/timesheet/manual'))?.[1] ?? null;
	/** A calendar day as #lib/format draws one, in a locale: the same Intl the server runs. */
	const utc = (/** @type {string} */ d) =>
		Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
	const drawn = (
		/** @type {string} */ locale,
		/** @type {string} */ from,
		/** @type {string} */ to = from,
		/** @type {Intl.DateTimeFormatOptions} */ options = {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}
	) =>
		new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).formatRange(
			utc(from),
			utc(to)
		);
	// The business's today: the day a new agreement starts unless it is changed.
	const businessDay = async () =>
		/id="a-starts"[^>]*?value="(\d{4}-\d{2}-\d{2})"/.exec(
			await page('/catalogue/agreements/new')
		)?.[1] ?? null;

	// Who "me" is and somebody who is not, and what their settings were, to put
	// back afterwards. Their zone and locale are in their own profile.
	const me = myId;
	const other = otherId;
	const profile = await page('/profile');
	const before = {
		timezone: detailHeld(profile, 'timezone') ?? '',
		locale: detailHeld(profile, 'locale') ?? '',
		hour_cycle: detailHeld(profile, 'hour_cycle') ?? '',
		week_start: detailHeld(profile, 'week_start') ?? ''
	};
	const business = detailHeld(await page('/settings/region'), 'timezone') || 'UTC';
	const setMine = (/** @type {string} */ name, /** @type {string} */ value) =>
		call('PATCH', `/api/people/${me}`, { fields: { [name]: value } });
	const setOwn = (/** @type {string} */ zone) => setMine('timezone', zone);
	const setBusiness = (/** @type {string} */ zone) =>
		call('PATCH', '/api/settings', { fields: { timezone: zone } });

	if (!me) {
		record(false, "a person's own zone is theirs", 'could not find who is signed in on /team');
	} else {
		// Read in British English on a 24-hour clock while this block runs, so
		// what it reads off the pages has one shape.
		await setMine('locale', 'en-GB');
		await setMine('hour_cycle', 'h23');

		// The person's day follows their own zone.
		/** @type {(string | null)[]} */
		const days = [];
		for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
			const saved = await setOwn(zone);
			const before = zoneDay(zone);
			const day = await formDay();
			days.push(day);
			record(
				saved.status === 200 && (day === before || day === zoneDay(zone)),
				`a person's today is theirs: in ${zone} it is ${day}`,
				`${saved.status} ${day} vs ${before}`
			);
		}
		record(
			days[0] !== null && days[1] !== null && days[0] !== days[1],
			'two people 25 hours apart are never on the same day',
			days.join(', ')
		);

		// One moment -- when a draft was assembled -- drawn on each person's clock.
		await setOwn('Pacific/Kiritimati');
		const listing = await page('/invoices');
		const ids = [
			...new Set([...listing.matchAll(/\/invoices\/([0-9a-f-]{36})/g)].map((m) => m[1]))
		];
		/** @type {string[]} */
		const clocks = [];
		/** @type {string | null} */
		let draft = null;
		for (const id of ids) {
			await setOwn('Pacific/Kiritimati');
			const k = /assembled (\d{2}):(\d{2})/i.exec(await page(`/invoices/${id}`));
			await setOwn('Pacific/Pago_Pago');
			const p = /assembled (\d{2}):(\d{2})/i.exec(await page(`/invoices/${id}`));
			if (!k || !p) continue;
			clocks.push(`${k[1]}:${k[2]}`, `${p[1]}:${p[2]}`);
			draft = id;
			break;
		}
		const minutes = (/** @type {string} */ hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
		record(
			clocks.length === 2 && (minutes(clocks[0]) - minutes(clocks[1]) + 1440) % 1440 === 60,
			"a moment is drawn on the person's clock",
			clocks.length
				? `Kiritimati ${clocks[0]}, Pago Pago ${clocks[1]}`
				: 'no draft showed when it was assembled'
		);

		// The same moment on a 12-hour clock: the clock is theirs too.
		if (draft) {
			await setMine('hour_cycle', 'h12');
			const twelve = /Assembled (\d{1,2}):(\d{2})\s?([ap]m)/i.exec(
				await page(`/invoices/${draft}`)
			);
			await setMine('hour_cycle', 'h23');
			record(
				twelve !== null,
				'a 12-hour clock reads as one',
				twelve ? twelve[0] : 'no am or pm on the assembled time'
			);
		}

		// How their dates read is theirs: the same day, in two locales. Today is
		// headed with the business's day (#lib/server/calendar), so that is the
		// day looked for, with the person and the business on dates that never
		// meet: the person's day would then be missed every time, not only in
		// the hours of a night when the two differ. Either day may turn over
		// while the page is read, so either side of the read is right.
		await setOwn('Pacific/Pago_Pago');
		await setBusiness('Pacific/Kiritimati');
		const full = /** @type {Intl.DateTimeFormatOptions} */ ({
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
		const headed = async (/** @type {string} */ locale) => {
			const before = zoneDay('Pacific/Kiritimati');
			const html = await page('/');
			return [before, zoneDay('Pacific/Kiritimati')].some((d) =>
				html.includes(drawn(locale, d, d, full))
			);
		};
		const gb = await headed('en-GB');
		await setMine('locale', 'en-US');
		const us = await headed('en-US');
		await setMine('locale', 'en-GB');
		await setBusiness(business);
		record(
			gb && us,
			"a person's locale is how their dates read",
			`British ${gb}, American ${us} for the business's ${zoneDay('Pacific/Kiritimati')}`
		);

		// And so is the day their week starts: every week on All entries begins
		// on it.
		const weeksStartOn = async (/** @type {number} */ weekday) => {
			const html = await page('/timesheet/all');
			const starts = [...html.matchAll(/Week of (\d{1,2}) (\w{3})/g)].map(([, d, mon]) => {
				const month = new Date(`${mon} 1 2000`).getMonth();
				let at = Date.UTC(new Date().getUTCFullYear(), month, +d);
				if (at > Date.now() + 2 * 86_400_000)
					at = Date.UTC(new Date().getUTCFullYear() - 1, month, +d);
				return new Date(at).getUTCDay();
			});
			return starts.length > 0 && starts.every((w) => w === weekday);
		};
		await setMine('week_start', '7');
		const sundays = await weeksStartOn(0);
		await setMine('week_start', '1');
		const mondays = await weeksStartOn(1);
		record(
			sundays && mondays,
			"a person's week starts on their own day",
			`Sundays ${sundays}, Mondays ${mondays}`
		);

		// A locale is saved as Intl spells it, and only if Intl can write in it.
		const spelled = await setMine('locale', 'en-gb');
		const nowhereLocale = await setMine('locale', 'xx-QQ');
		record(
			spelled.body?.saved?.locale === 'en-GB' && nowhereLocale.status === 400,
			'a locale is saved in its own spelling, and a made-up one is refused',
			`${spelled.status} ${JSON.stringify(spelled.body?.saved)} · ${nowhereLocale.status}`
		);

		// These are a person's own: nobody else can change them.
		if (other) {
			const theirs = await call('PATCH', `/api/people/${other}`, { fields: { locale: 'en-US' } });
			const theirZone = await call('PATCH', `/api/people/${other}`, {
				fields: { timezone: 'UTC' }
			});
			record(
				theirs.status === 403 && theirZone.status === 403,
				"somebody else's locale and zone are theirs to change",
				`${theirs.status} ${theirZone.status}`
			);
		}

		// The business's day follows the business's zone, whatever the person's.
		// Either day may turn over while it is read, so either side of the
		// read is right.
		const around = async (
			/** @type {string} */ zone,
			/** @type {() => Promise<string | null>} */ read
		) => {
			const before = zoneDay(zone);
			const day = await read();
			return { day, ok: day === before || day === zoneDay(zone) };
		};
		await setOwn('Pacific/Pago_Pago');
		await setBusiness('Pacific/Kiritimati');
		const own = await around('Pacific/Pago_Pago', formDay);
		const biz = await around('Pacific/Kiritimati', businessDay);
		record(
			own.ok && biz.ok,
			"the business's today is the business's, whatever the person's",
			`person ${own.day}, business ${biz.day}`
		);

		// A person with no zone of their own follows the business's.
		await setOwn('');
		const follows = await around('Pacific/Kiritimati', formDay);
		record(
			follows.ok,
			"a person with no zone set follows the business's",
			`${follows.day} vs ${zoneDay('Pacific/Kiritimati')}`
		);

		// A zone Postgres does not know is refused, for a person and for the business.
		const nowhere = await setOwn('Mars/Olympus_Mons');
		const nowhereBiz = await setBusiness('Mars/Olympus_Mons');
		record(
			nowhere.status === 400 && nowhereBiz.status === 400,
			'a zone that does not exist is refused',
			`${nowhere.status} ${nowhereBiz.status}`
		);

		// Put back as they were. The business's typed in lower case, to show it
		// is saved under Postgres's spelling.
		for (const [name, value] of Object.entries(before)) await setMine(name, value);
		const back = await setBusiness(business.toLowerCase());
		record(
			back.status === 200 && back.body?.saved?.timezone === business,
			`a zone typed in lower case is saved as ${business}`,
			`${back.status} ${JSON.stringify(back.body?.saved)}`
		);
	}
}

// Light or dark is the device's (#lib/device-fields): a cookie on it, which the
// server writes onto <html> before the page leaves, signed in or not.
{
	/** @param {string} theme */
	const set = (theme) =>
		fetch(`${base}/api/device`, {
			method: 'PATCH',
			headers: H,
			body: JSON.stringify({ fields: { theme } })
		});
	/** The theme a page was drawn in, as the cookies given leave it: Primer's colour mode. */
	const drawnIn = async (/** @type {string} */ path, /** @type {string} */ jar) =>
		/<html[^>]*\sdata-color-mode="([^"]*)"/.exec(
			await (await fetch(base + path, { headers: { cookie: jar } })).text()
		)?.[1] ?? null;
	const sent = (/** @type {Response} */ r) =>
		(r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('theme=')) ?? '';
	/** @param {boolean} ok @param {string} label @param {string} detail */
	const record = (ok, label, detail) => {
		if (ok) passed++;
		else failures.push(`${label}: ${detail}`);
		console.log(`  ${ok ? '✓' : '✗'} ${label}`);
	};

	const dark = await set('dark');
	const kept = sent(dark);
	record(
		dark.status === 200 && /httponly/i.test(kept) && /max-age=[1-9]/i.test(kept),
		'a theme is kept in a cookie on the device, for the server alone',
		`${dark.status} ${kept}`
	);
	const theme = kept.split(';')[0];
	const signedIn = await drawnIn('/profile', `${cookie}; ${theme}`);
	const signedOut = await drawnIn('/login', theme);
	const without = await drawnIn('/profile', cookie);
	record(
		signedIn === 'dark' && signedOut === 'dark' && without === 'auto',
		"a page is drawn in the device's theme from the first paint, signed in or not",
		`profile ${signedIn}, sign-in ${signedOut}, without the cookie ${without}`
	);

	const sepia = await set('sepia');
	record(sepia.status === 400, 'a theme that is not light or dark is refused', `${sepia.status}`);

	const back = await set('');
	record(
		back.status === 200 && /max-age=0/i.test(sent(back)),
		'left to the device, the cookie is taken away',
		`${back.status} ${sent(back)}`
	);
}

// ---------------------------------------------------------------------------
console.log('\n  typed tax areas — collected in, typed, confirmed, and let go');
{
	// Where no authority answers for an address, a state's areas are typed in
	// from its own table (#lib/server/typed-areas), and California's are CDTFA's.
	const nv = '/api/settings/tax/NV';
	const iso = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);
	const quarterOf = (/** @type {Date} */ d) =>
		new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (d.getUTCMonth() % 3), 1));
	// Last quarter's first day, which has begun on any clock, and the next's.
	const now = new Date();
	const from = iso(quarterOf(new Date(now.getTime() - 100 * 86400000)));
	const next = quarterOf(now);
	next.setUTCMonth(next.getUTCMonth() + 3);
	const coming = iso(next);
	const reno = [
		{ level: 'state', jurisdiction: 'Nevada', rate_pct: '6.85' },
		{ level: 'local', jurisdiction: 'Washoe County', rate_pct: '1.415' }
	];

	await check(
		'California’s areas are not typed in',
		'POST',
		'/api/settings/tax/CA/areas',
		{
			fields: { name: 'Woodland', from },
			pieces: reno
		},
		404
	);
	await check(
		'collecting in Nevada without saying what it taxes is refused, said for each kind',
		'PUT',
		nv,
		{ taxed: { [KIND.goods]: true } },
		(r) => r.status === 400 && Boolean(r.body?.errors?.[`taxed.${KIND.repair}`])
	);
	await check(
		'the business collects in Nevada, saying whether it taxes each kind',
		'PUT',
		nv,
		{ taxed: await everyKind(true) },
		(r) => [200, 201].includes(r.status)
	);
	await check(
		'an area with no pieces is refused, said where',
		'POST',
		`${nv}/areas`,
		{ fields: { name: `Reno ${stamp}`, from }, pieces: [] },
		(r) => r.status === 400 && Boolean(r.body?.errors?.pieces)
	);
	const area = await check(
		'an area of Nevada is typed in, its rate from a day',
		'POST',
		`${nv}/areas`,
		{ fields: { name: `Reno ${stamp}`, code: '', from }, pieces: reno },
		201
	);
	const at = `${nv}/areas/${area.body?.id}`;
	await check(
		'a second of the same name is refused',
		'POST',
		`${nv}/areas`,
		{ fields: { name: `RENO ${stamp}`, from }, pieces: reno },
		(r) => r.status === 400 && Boolean(r.body?.errors?.name)
	);
	await check(
		'a coming rate the same as today’s is refused',
		'PUT',
		`${at}/rates/${coming}`,
		{ pieces: reno },
		(r) => r.status === 400 && Boolean(r.body?.errors?.pieces)
	);
	await check(
		'the coming quarter’s rate is typed',
		'PUT',
		`${at}/rates/${coming}`,
		{
			pieces: [reno[0], { ...reno[1], rate_pct: '1.525' }]
		},
		201
	);
	await check(
		'it is confirmed, one action',
		'POST',
		`${at}/confirm`,
		undefined,
		(r) => r.status === 200 && typeof r.body?.confirmed_on === 'string'
	);
	await check('it is renamed', 'PATCH', at, { fields: { name: `Reno city ${stamp}` } }, 200);
	const page = await fetch(`${base}/settings/tax/NV/${area.body?.id}`, { headers: { cookie } });
	const html = await page.text();
	const shown =
		page.status === 200 && html.includes(`Reno city ${stamp}`) && html.includes('8.265%');
	if (shown) passed++;
	else failures.push(`a typed area's page: ${page.status}`);
	console.log(`  ${shown ? '✓' : '✗'} its page says its name, and its rate today`);
	await check(
		'its only rate in force today stays',
		'DELETE',
		`${at}/rates/${from}`,
		undefined,
		409
	);
	await check('the coming rate is taken away', 'DELETE', `${at}/rates/${coming}`, undefined, 204);

	// A California site's area is CDTFA's to say, never chosen.
	const db = new pg.Client(database());
	await db.connect();
	const ca = (
		await db.query(
			`select e.slug as client, s.slug as site from site s join entity e on e.id = s.entity_id
			  where s.region = 'CA' and s.active order by e.slug, s.slug limit 1`
		)
	).rows[0];
	await db.end();
	if (ca)
		await check(
			'a California site’s area is not chosen by hand',
			'PUT',
			`/api/clients/${ca.client}/sites/${ca.site}/area`,
			{ fields: { area: area.body?.id } },
			409
		);
	await check('an area no site was ever in is taken away', 'DELETE', at, undefined, 204);
	await check('the business stops collecting in Nevada', 'DELETE', nv, undefined, 204);
}

// ---------------------------------------------------------------------------
console.log('\n  a piece for one kind of sale — typed, and charged on that kind alone');
{
	// A typed area's piece can fall on one kind alone, whether or not the state
	// taxes it (#196): here Washoe County's 0.5% on goods, beside its 1.415% on
	// everything Nevada taxes. The site stays in its area once placed, so the
	// area is one of this section's own.
	const nv = '/api/settings/tax/NV';
	const iso = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);
	const quarter = new Date();
	quarter.setUTCDate(1);
	quarter.setUTCMonth(quarter.getUTCMonth() - (quarter.getUTCMonth() % 3) - 3);
	const from = iso(quarter);
	const every = [
		{ level: 'state', jurisdiction: 'Nevada', rate_pct: '6.85' },
		{ level: 'local', jurisdiction: 'Washoe County', rate_pct: '1.415' }
	];
	const onGoods = { level: 'local', jurisdiction: 'Washoe County', rate_pct: '0.5' };

	await check(
		'the business collects in Nevada again, taxing every kind',
		'PUT',
		nv,
		{ taxed: await everyKind(true) },
		(r) => [200, 201].includes(r.status)
	);
	await check(
		'a piece for a kind of sale there is not is refused, said where',
		'POST',
		`${nv}/areas`,
		{
			fields: { name: `Sparks ${stamp}`, from },
			pieces: [...every, { ...onGoods, sale_kind_id: crypto.randomUUID() }]
		},
		(r) => r.status === 400 && Boolean(r.body?.errors?.['pieces.2.sale_kind_id'])
	);
	await check(
		'one levying twice on a kind alone is refused, said where',
		'POST',
		`${nv}/areas`,
		{
			fields: { name: `Sparks ${stamp}`, from },
			pieces: [
				...every,
				{ ...onGoods, sale_kind_id: KIND.goods },
				{ ...onGoods, sale_kind_id: KIND.goods }
			]
		},
		(r) => r.status === 400 && Boolean(r.body?.errors?.['pieces.3.jurisdiction'])
	);
	const area = await check(
		'an area with a piece on goods alone is typed, beside its pieces on every kind',
		'POST',
		`${nv}/areas`,
		{
			fields: { name: `Sparks ${stamp}`, from },
			pieces: [...every, { ...onGoods, sale_kind_id: KIND.goods }]
		},
		201
	);
	const page = await fetch(`${base}/settings/tax/NV/${area.body?.id}`, { headers: { cookie } });
	const html = await page.text();
	const says =
		page.status === 200 &&
		html.includes('8.265%') &&
		html.includes('Washoe County 0.500% on Goods');
	if (says) passed++;
	else failures.push(`a typed area's page with a piece on one kind: ${page.status}`);
	console.log(
		`  ${says ? '✓' : '✗'} its page says its rate on every kind, and the piece on goods alone`
	);

	// A Nevada site, chosen into it. A site's address is Google's to give, so
	// this one is written straight in, and its area chosen as a person would.
	const db = new pg.Client(database());
	await db.connect();
	const client = (await db.query(`select id, slug from entity where active order by slug limit 1`))
		.rows[0];
	const site = (
		await db.query(
			`insert into site (entity_id, label, slug, street, city, region, postcode)
			 values ($1, $2, $3, '1 Victorian Ave', 'Sparks', 'NV', '89431') returning id, slug`,
			[client.id, `Sparks shop ${stamp}`, `sparks-shop-${stamp}`]
		)
	).rows[0];
	await check(
		'the Nevada site is chosen into it',
		'PUT',
		`/api/clients/${client.slug}/sites/${site.slug}/area`,
		{ fields: { area: area.body?.id } },
		200
	);
	const draft = await call('POST', '/api/drafts', {
		client_uuid: crypto.randomUUID(),
		entity_id: client.id
	});
	/** Goods bought for the job at the Nevada site: how they were taxed, and by whom. */
	const bought = async () => {
		const form = new FormData();
		const fields = {
			client_uuid: crypto.randomUUID(),
			invoice_id: draft.body?.id,
			kind: 'bought',
			description: `Piece for one kind ${stamp}`,
			site_id: site.id,
			ex_tax_cost: '10.00',
			tax_paid: '0'
		};
		for (const [k, v] of Object.entries(fields)) form.set(k, v);
		const { 'content-type': _, ...headers } = H;
		const r = await fetch(`${base}/api/lines`, { method: 'POST', headers, body: form });
		const id = /** @type {{ id?: string }} */ (await r.json().catch(() => ({}))).id;
		return id
			? (
					await db.query(
						`select tax_source, tax_rate_pct::text as rate, tax_pieces as pieces
						   from invoice_line where id = $1`,
						[id]
					)
				).rows[0]
			: null;
	};
	const both = await bought();
	const all =
		both?.tax_source === 'site' &&
		both?.rate === '8.7650' &&
		// As values: Postgres keeps a jsonb object's keys in an order of its own.
		isDeepStrictEqual(both?.pieces, [
			{ level: 'state', jurisdiction: 'Nevada', rate: '6.8500' },
			{ level: 'local', jurisdiction: 'Washoe County', rate: '1.4150' },
			{ level: 'local', jurisdiction: 'Washoe County', rate: '0.5000', kind: KIND.goods }
		]);
	if (all) passed++;
	else failures.push(`goods where Nevada taxes goods: ${JSON.stringify(both)}`);
	console.log(
		`  ${all ? '✓' : '✗'} goods are taxed on every kind's pieces and goods' own, each kept`
	);
	await check(
		'Nevada is said not to tax goods',
		'PATCH',
		`${nv}/kinds/${KIND.goods}`,
		{ fields: { taxed: 'false' } },
		200
	);
	const own = await bought();
	const alone =
		own?.tax_source === 'site' &&
		own?.rate === '0.5000' &&
		isDeepStrictEqual(own?.pieces, [
			{ level: 'local', jurisdiction: 'Washoe County', rate: '0.5000', kind: KIND.goods }
		]);
	if (alone) passed++;
	else failures.push(`goods where Nevada does not tax goods: ${JSON.stringify(own)}`);
	console.log(
		`  ${alone ? '✓' : '✗'} where Nevada does not, by the piece on goods alone, and it alone`
	);

	// A kind an area's piece is for stays, as a kind something is sold as does.
	const kind = await check(
		'a kind of the business’s own is added',
		'POST',
		'/api/settings/tax/kinds',
		{ fields: { name: `Meals ${stamp}` }, taxed: await everyState(true) },
		201
	);
	await check(
		'a piece on it alone is typed into the area',
		'PUT',
		`${nv}/areas/${area.body?.id}/rates/${from}`,
		{
			pieces: [
				...every,
				{ ...onGoods, sale_kind_id: KIND.goods },
				{ ...onGoods, rate_pct: '0.75', sale_kind_id: kind.body?.id }
			]
		},
		200
	);
	await check(
		'a kind an area’s piece is for is kept',
		'DELETE',
		`/api/settings/tax/kinds/${kind.body?.id}`,
		undefined,
		(r) => r.status === 409 && /piece of its own/.test(r.body?.detail ?? '')
	);
	await db.end();
	await check('the business stops collecting in Nevada', 'DELETE', nv, undefined, 204);
}

// ---------------------------------------------------------------------------
console.log('\n  kinds of sale — added, answered, given, retired, and let go');
{
	// Each state the business collects in answers each kind (#lib/server/sale-kinds).
	const kinds = '/api/settings/tax/kinds';
	const ca = (/** @type {string} */ k) => `/api/settings/tax/CA/kinds/${k}`;
	await check(
		'a kind with no name is refused',
		'POST',
		kinds,
		{ fields: { name: '' }, taxed: await everyState(false) },
		(r) => r.status === 400 && Boolean(r.body?.errors?.name)
	);
	await check(
		'a kind California has not answered is refused, said where',
		'POST',
		kinds,
		{ fields: { name: `Help line ${stamp}` }, taxed: {} },
		(r) => r.status === 400 && Boolean(r.body?.errors?.['taxed.CA'])
	);
	const made = await check(
		'a kind of the business’s own is added, with every state’s answer',
		'POST',
		kinds,
		{ fields: { name: `Help line ${stamp}` }, taxed: await everyState(false) },
		201
	);
	const kind = made.body?.id;
	const at = `${kinds}/${kind}`;
	await check(
		'a second of the same name is refused',
		'POST',
		kinds,
		{ fields: { name: `HELP LINE ${stamp}` }, taxed: await everyState(false) },
		(r) => r.status === 400 && Boolean(r.body?.errors?.name)
	);
	await check('it is renamed', 'PATCH', at, { fields: { name: `Remote help ${stamp}` } }, 200);
	await check(
		'California’s answer for it is changed',
		'PATCH',
		ca(kind),
		{ fields: { taxed: 'true' } },
		(r) => r.status === 200 && r.body?.saved?.taxed === 'true'
	);
	await check(
		'an answer that is not yes or no is refused',
		'PATCH',
		ca(kind),
		{ fields: { taxed: 'sometimes' } },
		(r) => r.status === 400 && Boolean(r.body?.errors?.taxed)
	);
	await check(
		'an answer for a state the business does not collect in is not found',
		'PATCH',
		`/api/settings/tax/NV/kinds/${kind}`,
		{ fields: { taxed: 'true' } },
		404
	);
	const svc = await check(
		'a service of that kind is made',
		'POST',
		'/api/services',
		{
			fields: { name: `Remote help ${stamp}`, unit: 'hour', sale_kind_id: kind },
			client_uuid: crypto.randomUUID()
		},
		201
	);
	const service = `/api/services/${svc.body?.id}`;
	await check(
		'a kind something is sold as is kept',
		'DELETE',
		at,
		undefined,
		(r) => r.status === 409
	);
	await check('it is retired', 'PATCH', at, { fields: { active: 'false' } }, 200);
	await check(
		'its service is made another kind',
		'PATCH',
		service,
		{ fields: { sale_kind_id: KIND.repair } },
		200
	);
	await check(
		'a service is not made a retired kind, said where',
		'PATCH',
		service,
		{ fields: { sale_kind_id: kind } },
		(r) => r.status === 400 && Boolean(r.body?.errors?.sale_kind_id)
	);
	for (const [path, words] of [
		[`/settings/tax/kinds/${kind}`, `Remote help ${stamp}`],
		['/settings/tax/kinds/new', 'Taxed where the business collects'],
		['/settings/tax/CA', 'What it taxes']
	]) {
		const page = await fetch(`${base}${path}`, { headers: { cookie } });
		const text = await page.text();
		if (page.status === 200 && text.includes(words)) passed++;
		else failures.push(`${path} does not say “${words}” (${page.status})`);
	}
	await check(
		'one of reckon’s own kinds stays',
		'DELETE',
		`${kinds}/${KIND.goods}`,
		undefined,
		409
	);
	// A line is taxed by its kind's answer in its site's state: goods bought for
	// the job as goods, and a cost passed on as no sale at all.
	// A draft of its own, for a client with a California site placed in an area.
	const placed = (
		await kindsDb.query(
			`select s.entity_id as client, s.id as site from site s
			  where s.active and s.region = 'CA' and s.tax_area_id is not null
			  order by s.slug limit 1`
		)
	).rows[0];
	const draft = placed
		? await call('POST', '/api/drafts', {
				client_uuid: crypto.randomUUID(),
				entity_id: placed.client
			})
		: null;
	const where = draft?.body?.id ? { invoice: draft.body.id, site: placed.site } : null;
	/** A line passed on, at the site, as the phone's queue sends it: its id and how it was taxed. */
	const passOn = async (/** @type {'bought' | 'paid_for'} */ kind) => {
		// Only called once there is one.
		const to = /** @type {{ invoice: string; site: string }} */ (where);
		const form = new FormData();
		const fields = {
			client_uuid: crypto.randomUUID(),
			invoice_id: to.invoice,
			kind,
			description: `Kinds check ${kind} ${stamp}`,
			site_id: to.site,
			ex_tax_cost: '10.00',
			tax_paid: '0'
		};
		for (const [k, v] of Object.entries(fields)) form.set(k, v);
		const { 'content-type': _, ...headers } = H;
		const r = await fetch(`${base}/api/lines`, { method: 'POST', headers, body: form });
		const id = /** @type {{ id?: string }} */ (await r.json().catch(() => ({}))).id;
		const row = id
			? (
					await kindsDb.query(
						'select taxable, tax_source, sale_kind_id, tax_rate_pct::text as rate from invoice_line where id = $1',
						[id]
					)
				).rows[0]
			: null;
		return { id, row };
	};
	if (!where) failures.push('no California site placed in an area, to start a draft for');
	else {
		const taxed = await passOn('bought');
		await check(
			'goods bought for the job are taxed where the state taxes goods, sold as goods',
			'PATCH',
			ca(KIND.goods),
			{ fields: { taxed: 'false' } },
			(r) =>
				r.status === 200 &&
				taxed.row?.taxable === true &&
				taxed.row?.tax_source === 'site' &&
				taxed.row?.sale_kind_id === KIND.goods
		);
		const untaxed = await passOn('bought');
		const cost = await passOn('paid_for');
		await check(
			'and not where it says it does not, while a cost passed on is no kind of sale',
			'PATCH',
			ca(KIND.goods),
			{ fields: { taxed: 'true' } },
			(r) =>
				r.status === 200 &&
				untaxed.row?.taxable === false &&
				untaxed.row?.tax_source === 'none' &&
				untaxed.row?.sale_kind_id === KIND.goods &&
				cost.row?.taxable === false &&
				cost.row?.sale_kind_id === null
		);
		for (const line of [taxed, untaxed, cost])
			if (line.id) await call('DELETE', `/api/lines/${line.id}?force=1`);

		// A line's tax set by hand (#196), where this one is the exception to its
		// kind: California taxes goods, so goods bought for the job not taxed,
		// with why; then at another rate; then as its kind is taxed again.
		/** A line's form sent as the phone's queue sends it, and the line as it is then. */
		const lineForm = async (
			/** @type {string} */ method,
			/** @type {string} */ path,
			/** @type {Record<string, string>} */ fields
		) => {
			const form = new FormData();
			for (const [k, v] of Object.entries(fields)) form.set(k, v);
			const { 'content-type': _, ...headers } = H;
			const r = await fetch(base + path, { method, headers, body: form });
			const body = await r.json().catch(() => null);
			return { status: r.status, body };
		};
		const rowOf = async (/** @type {string} */ id) =>
			(
				await kindsDb.query(
					`select taxable, tax_rate_pct::text as rate, tax_source, tax_override_reason as reason,
					        tax_state, tax_jurisdiction is not null as said_where, tax_pieces is not null as pieces,
					        tax_exemption_id as exemption
					   from invoice_line where id = $1`,
					[id]
				)
			).rows[0];
		/** `ok` is whether it went as it should; `what` is said either way. */
		const expect = (/** @type {boolean} */ ok, /** @type {string} */ what, detail = '') => {
			if (ok) passed++;
			else failures.push(`${what}: ${detail}`);
			console.log(`  ${ok ? '✓' : '✗'} ${what}`);
		};
		const goods = {
			kind: 'bought',
			description: `By-hand check ${stamp}`,
			site_id: where.site,
			ex_tax_cost: '10.00',
			tax_paid: '0'
		};
		const why = 'Wire installed in the walls: the business is the consumer (Reg 1521)';
		const noWhy = await lineForm('POST', '/api/lines', {
			...goods,
			client_uuid: crypto.randomUUID(),
			invoice_id: where.invoice,
			taxable: 'false'
		});
		expect(
			noWhy.status === 400 && Boolean(noWhy.body?.errors?.tax_override_reason),
			'a line’s tax set by hand without why is refused, said where',
			`${noWhy.status} ${JSON.stringify(noWhy.body?.errors)}`
		);
		const made = await lineForm('POST', '/api/lines', {
			...goods,
			client_uuid: crypto.randomUUID(),
			invoice_id: where.invoice,
			taxable: 'false',
			tax_override_reason: why
		});
		const id = /** @type {string | undefined} */ (made.body?.id);
		const notTaxed = id ? await rowOf(id) : null;
		expect(
			made.status === 200 &&
				notTaxed?.taxable === false &&
				notTaxed?.tax_source === 'none' &&
				notTaxed?.reason === why,
			'goods bought for the job, not taxed by hand, with why',
			`${made.status} ${JSON.stringify(notTaxed)}`
		);
		if (id) {
			const kept = await lineForm('PATCH', `/api/lines/${id}`, {
				...goods,
				description: `By-hand check ${stamp}, two boxes`
			});
			const still = await rowOf(id);
			expect(
				kept.status === 200 && still?.taxable === false && still?.reason === why,
				'a change that says nothing of its tax keeps the tax set by hand',
				`${kept.status} ${JSON.stringify(still)}`
			);
			const siteRate = taxed.row?.rate ?? '';
			const same = await lineForm('PATCH', `/api/lines/${id}`, {
				...goods,
				taxable: 'true',
				tax_rate_pct: siteRate,
				tax_override_reason: 'Partly exempt'
			});
			expect(
				same.status === 400 && Boolean(same.body?.errors?.tax_rate_pct),
				'another rate that is the site’s own is refused, said where',
				`${same.status} ${JSON.stringify(same.body?.errors)}`
			);
			const anyway = await lineForm('PATCH', `/api/lines/${id}`, {
				...goods,
				taxable: 'true',
				tax_override_reason: 'Taxed'
			});
			expect(
				anyway.status === 400 && Boolean(anyway.body?.errors?.taxable),
				'taxed at the site’s rate by hand, where its kind is anyway, is refused',
				`${anyway.status} ${JSON.stringify(anyway.body?.errors)}`
			);
			const other = await lineForm('PATCH', `/api/lines/${id}`, {
				...goods,
				taxable: 'true',
				tax_rate_pct: '4.0625',
				tax_override_reason: 'Partly exempt'
			});
			const atOther = await rowOf(id);
			expect(
				other.status === 200 &&
					atOther?.taxable === true &&
					atOther?.rate === '4.0625' &&
					atOther?.tax_source === 'override' &&
					atOther?.tax_state === 'CA' &&
					atOther?.said_where === true &&
					atOther?.pieces === false,
				'taxed at another rate by hand: an override, owed where it went, levied by nobody named',
				`${other.status} ${JSON.stringify(atOther)}`
			);
			const back = await lineForm('PATCH', `/api/lines/${id}`, { ...goods, taxable: '' });
			const asKind = await rowOf(id);
			expect(
				back.status === 200 &&
					asKind?.taxable === true &&
					asKind?.tax_source === 'site' &&
					asKind?.reason === null &&
					asKind?.pieces === true,
				'and taxed as its kind is again, with no reason kept on it',
				`${back.status} ${JSON.stringify(asKind)}`
			);
			const told = (
				await kindsDb.query(
					`select count(*)::int as n from record_history
					  where table_name = 'invoice_line' and row_id = $1 and field = 'tax_override_reason'`,
					[id]
				)
			).rows[0];
			expect(
				told?.n >= 2,
				'why its tax was set by hand is kept in its history',
				JSON.stringify(told)
			);
			await call('DELETE', `/api/lines/${id}?force=1`);
		}
		const passedOn = await lineForm('POST', '/api/lines', {
			...goods,
			kind: 'paid_for',
			client_uuid: crypto.randomUUID(),
			invoice_id: where.invoice,
			taxable: 'false',
			tax_override_reason: 'Not a sale'
		});
		expect(
			passedOn.status === 400 && Boolean(passedOn.body?.errors?.taxable),
			'a cost passed on has no tax to set by hand',
			`${passedOn.status} ${JSON.stringify(passedOn.body?.errors)}`
		);

		// A client exempt in California (#207): goods on their draft there are
		// untaxed by the exemption, which each names, from when it is recorded;
		// taxed again once it ends; and it stays with an invoice that went out.
		const exemptions = `/api/clients/${placed.client}/exemptions`;
		const add = (/** @type {Record<string, string>} */ more = {}) =>
			lineForm('POST', '/api/lines', {
				...goods,
				client_uuid: crypto.randomUUID(),
				invoice_id: where.invoice,
				...more
			});
		const before = await add();
		const { rows: collected } = await kindsDb.query('select state from tax_registration');
		const elsewhere = ['VT', 'WY', 'ME'].find((s) => !collected.some((r) => r.state === s));
		await check(
			'an exemption with no reason is refused',
			'POST',
			exemptions,
			{ fields: { state: 'CA', supported_by: `SR-${stamp}` }, kinds: null },
			(r) => r.status === 400 && Boolean(r.body?.errors?.reason)
		);
		await check(
			'and one where the business does not collect',
			'POST',
			exemptions,
			{ fields: { state: elsewhere, reason: 'resale', supported_by: `SR-${stamp}` }, kinds: null },
			(r) => r.status === 400 && Boolean(r.body?.errors?.state)
		);
		await check(
			'and one for some kinds that names none',
			'POST',
			exemptions,
			{ fields: { state: 'CA', reason: 'resale', supported_by: `SR-${stamp}` }, kinds: [] },
			(r) => r.status === 400 && Boolean(r.body?.errors?.kinds)
		);
		const resale = await call('POST', exemptions, {
			fields: { state: 'CA', reason: 'resale', supported_by: `SR-${stamp}` },
			kinds: [KIND.goods]
		});
		const xid = /** @type {string | undefined} */ (resale.body?.id);
		const onDraft = before.body?.id ? await rowOf(before.body.id) : null;
		expect(
			resale.status === 201 &&
				onDraft?.taxable === false &&
				onDraft?.tax_source === 'exempt' &&
				onDraft?.exemption === xid &&
				onDraft?.said_where === false,
			'a resale certificate recorded untaxes the goods already on their draft, each naming it',
			`${resale.status} ${JSON.stringify(onDraft)}`
		);
		const after = await add();
		const exempt = after.body?.id ? await rowOf(after.body.id) : null;
		expect(
			after.status === 200 && exempt?.tax_source === 'exempt' && exempt?.exemption === xid,
			'and goods added after it are exempt by it',
			`${after.status} ${JSON.stringify(exempt)}`
		);
		const own = await add({
			taxable: 'true',
			tax_override_reason: 'For their own use: their purchase order says taxable'
		});
		const ownRow = own.body?.id ? await rowOf(own.body.id) : null;
		expect(
			own.status === 200 &&
				ownRow?.taxable === true &&
				ownRow?.tax_source === 'site' &&
				ownRow?.exemption === null,
			'goods taxed by hand, saying why, are the exception to it',
			`${own.status} ${JSON.stringify(ownRow)}`
		);
		const anyway = await add({ taxable: 'false', tax_override_reason: 'Exempt' });
		expect(
			anyway.status === 400 && Boolean(anyway.body?.errors?.taxable),
			'and not taxed by hand is refused: they are not taxed anyway',
			`${anyway.status} ${JSON.stringify(anyway.body?.errors)}`
		);
		await check('the exemption is ended today', 'POST', `${exemptions}/${xid}/end`, undefined, 204);
		const again = before.body?.id ? await rowOf(before.body.id) : null;
		const kept = own.body?.id ? await rowOf(own.body.id) : null;
		expect(
			again?.taxable === true &&
				again?.tax_source === 'site' &&
				again?.exemption === null &&
				again?.pieces === true &&
				kept?.reason !== null,
			'ended, what it untaxed on the draft is taxed again, and what was set by hand stays',
			`${JSON.stringify(again)} ${JSON.stringify(kept)}`
		);
		await check(
			'ending it again is what was asked',
			'POST',
			`${exemptions}/${xid}/end`,
			undefined,
			204
		);
		await check(
			'and it is taken off, nothing having gone out',
			'DELETE',
			`${exemptions}/${xid}`,
			undefined,
			204
		);
		await check('and is gone', 'DELETE', `${exemptions}/${xid}`, undefined, 404);
		for (const line of [before, after, own])
			if (line.body?.id) await call('DELETE', `/api/lines/${line.body.id}?force=1`);

		// One an invoice that went out was untaxed by stays with it, and is ended.
		const federal = await call('POST', exemptions, {
			fields: { state: 'CA', reason: 'federal_government', supported_by: `PO-${stamp}` },
			kinds: null
		});
		const sent = await call('POST', '/api/drafts', {
			client_uuid: crypto.randomUUID(),
			entity_id: placed.client
		});
		const billed = sent.body?.id
			? await lineForm('POST', '/api/lines', {
					...goods,
					client_uuid: crypto.randomUUID(),
					invoice_id: sent.body.id
				})
			: null;
		await call('POST', `/api/invoices/${sent.body?.id}/send`);
		await check(
			'an exemption an invoice that went out was untaxed by is not taken off',
			'DELETE',
			`${exemptions}/${federal.body?.id}`,
			undefined,
			(r) => r.status === 400 && Boolean(r.body?.errors?.exemption) && billed?.status === 200
		);
		await check(
			'it is ended instead',
			'POST',
			`${exemptions}/${federal.body?.id}/end`,
			undefined,
			204
		);
	}
	await check('the service is taken away', 'DELETE', service, undefined, 200);
	await check('a kind nothing is sold as is taken away', 'DELETE', at, undefined, 204);
	await check('and is gone', 'PATCH', at, { fields: { name: 'Back' } }, 404);
}

// Sales tax handed over (#203): a return, and what is paid for its period,
// bring what is held down, a state at a time; the home page's figure is every
// state's added up, as the report has it.
{
	console.log('\nSales tax handed over');
	// An amount as a page shows it, in cents: its sign, then its digits, read
	// out of the markup around them -- "$0.50", "-$41.50".
	const cents = (/** @type {string | undefined} */ v) => {
		const m = /([-−])?[^\d\s<>]*([\d,]+(?:\.\d+)?)/.exec(v ?? '');
		return m ? (m[1] ? -1 : 1) * Math.round(Number(m[2].replaceAll(',', '')) * 100) : NaN;
	};
	const page = async (/** @type {string} */ path) =>
		(await fetch(base + path, { headers: { cookie, ...PROXY } })).text();
	// A figure as the page shows it, after a label: its class is scoped, and its
	// text may sit between Svelte's markers.
	const figureAfter = (/** @type {string} */ label) =>
		new RegExp(`${label}[\\s\\S]*?class="v[^"]*">([\\s\\S]*?)</span>`, 'g');
	const heldHome = async () => cents(figureAfter('Sales tax held').exec(await page('/'))?.[1]);
	// Each state's: still held, or handed over beyond what was collected there.
	const heldEach = async () =>
		[
			...(await page('/reports/sales-tax')).matchAll(
				figureAfter('(Still held|Handed over beyond what was collected)')
			)
		].map((m) => (m[1] === 'Still held' ? 1 : -1) * cents(m[2]));
	const agree = async (/** @type {string} */ label) => {
		const [home, each] = [await heldHome(), await heldEach()];
		const ok = each.length > 0 && home === each.reduce((a, b) => a + b, 0);
		if (ok) passed++;
		else failures.push(`${label}: home ${home}, states ${each.join(' + ')}`);
		console.log(`  ${ok ? '✓' : '✗'} ${label}`);
		return home;
	};
	const ref = `W-${stamp}`;
	const returns = '/api/sales-tax/CA/returns';
	const payments = '/api/sales-tax/CA/payments';
	const quarter = { period_start: '2020-01-01', period_end: '2020-03-31' };
	const before = await agree(
		'the home page’s Sales tax held is every state’s still held, added up'
	);

	await check(
		'a return filed before its period ends is refused',
		'POST',
		returns,
		{ ...quarter, filed_on: '2020-03-30', tax: '1.23' },
		(r) => r.status === 400 && Boolean(r.body?.errors?.filed_on)
	);
	await check(
		'a return keeping more than its tax is refused',
		'POST',
		returns,
		{ ...quarter, filed_on: '2020-04-20', tax: '1.23', kept: '1.24' },
		(r) => r.status === 400 && Boolean(r.body?.errors?.kept)
	);
	await check(
		'a return for a state with no tax there is not found',
		'POST',
		'/api/sales-tax/WY/returns',
		{ ...quarter, filed_on: '2020-04-20', tax: '1.23' },
		404
	);
	await check(
		'nor for what is not a state',
		'POST',
		'/api/sales-tax/ZZ/payments',
		{ ...quarter, paid_on: '2020-04-20', tax: '1.23' },
		404
	);

	const first = await check(
		'a return is recorded, with what was paid with it',
		'POST',
		returns,
		{ ...quarter, filed_on: '2020-04-20', tax: '1.23', paid: '1.23', reference: ref },
		201
	);
	const rows = async () =>
		(
			await kindsDb.query(
				`select r.id, r.tax::text, r.amends, (select coalesce(sum(p.tax), 0)::text from tax_payment p
			   where p.state = r.state and p.period_start = r.period_start and p.period_end = r.period_end) as paid
			   from tax_return r where r.state = 'CA' and r.period_start = '2020-01-01' order by r.filed_on`
			)
		).rows;
	{
		const [r] = await rows();
		const ok = r?.tax === '1.230' && r?.paid === '1.230' && r?.amends === null;
		if (ok) passed++;
		else failures.push(`the return and its payment: ${JSON.stringify(r)}`);
		console.log(`  ${ok ? '✓' : '✗'} what was paid with it is a payment of its own, on the day`);
	}
	const after = await agree('and still agrees once a return is paid');
	{
		const ok = before - after === 123;
		if (ok) passed++;
		else failures.push(`held went from ${before} to ${after}, not down by 123`);
		console.log(`  ${ok ? '✓' : '✗'} what is held comes down by the tax handed over`);
	}
	const report = await page('/reports/sales-tax');
	{
		const ok = report.includes(ref) && report.includes('Returns and payments');
		if (ok) passed++;
		else failures.push('the report does not show the return');
		console.log(`  ${ok ? '✓' : '✗'} the report shows the return, by its confirmation`);
	}

	const amended = await check(
		'a return filed again for its period is its amended return',
		'POST',
		returns,
		{ ...quarter, filed_on: '2020-05-02', tax: '2.00', paid: '0.77' },
		201
	);
	{
		const [was, is] = await rows();
		const ok = is?.amends === was?.id && is?.paid === '2.000';
		if (ok) passed++;
		else failures.push(`the amended return: ${JSON.stringify(is)}`);
		console.log(`  ${ok ? '✓' : '✗'} it amends the one before, and both payments count towards it`);
	}
	await check(
		'a payment for a month inside that quarter is refused',
		'POST',
		payments,
		{ period_start: '2020-02-01', period_end: '2020-02-29', paid_on: '2020-03-24', tax: '1.00' },
		(r) => r.status === 400 && Boolean(r.body?.errors?.period_start)
	);
	await check(
		'a payment of nothing is refused',
		'POST',
		payments,
		{ ...quarter, paid_on: '2020-06-01' },
		(r) => r.status === 400 && Boolean(r.body?.errors?.tax)
	);
	const late = await check(
		'penalty and interest are paid alone',
		'POST',
		payments,
		{ ...quarter, paid_on: '2020-06-01', penalty_and_interest: '0.15' },
		201
	);
	{
		const now = await agree('and it still agrees');
		const ok = after - now === 77;
		if (ok) passed++;
		else failures.push(`held went from ${after} to ${now}, not down by 77`);
		console.log(`  ${ok ? '✓' : '✗'} penalty and interest bring nothing down`);
	}

	await check(
		'a return an amended return corrects is not taken off',
		'DELETE',
		`${returns}/${first.body?.id}`,
		undefined,
		(r) => r.status === 400 && Boolean(r.body?.errors?.return)
	);
	await check(
		'the amended return is taken off',
		'DELETE',
		`${returns}/${amended.body?.id}`,
		undefined,
		204
	);
	await check(
		'then the one it corrected',
		'DELETE',
		`${returns}/${first.body?.id}`,
		undefined,
		204
	);
	await check('and is gone', 'DELETE', `${returns}/${first.body?.id}`, undefined, 404);
	await check('a payment is taken off', 'DELETE', `${payments}/${late.body?.id}`, undefined, 204);
	await kindsDb.query(
		`delete from tax_payment where state = 'CA' and period_start = '2020-01-01' and period_end = '2020-03-31'`
	);
	{
		const ok = (await heldHome()) === before;
		if (ok) passed++;
		else failures.push('held is not back where it was');
		console.log(`  ${ok ? '✓' : '✗'} with them gone, what is held is back where it was`);
	}
}
await kindsDb.end();

console.log('');
if (failures.length) {
	console.error(`${failures.length} write path(s) failed, ${passed} passed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`${passed} write paths exercised, all as expected.`);
