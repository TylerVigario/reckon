#!/usr/bin/env node
/**
 * Exercises everything that WRITES, and checks what it wrote.
 *
 *   node tests/write-check.mjs <base-url> <email> <password>
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
const [, , base = 'http://127.0.0.1:5181', email, password] = process.argv;

// In production a TLS proxy stands in front, and the server takes the scheme
// from it. Over plain http this says what that proxy would -- the server is
// started with PROTOCOL_HEADER=x-forwarded-proto to read it. Without it the
// server assumes https, and refuses every form post as cross-site.
/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

let passed = 0;
const failures = [];

const login = async () => {
	const body = new URLSearchParams({ email, password: password ?? '', next: '/' });
	const r = await fetch(`${base}/login`, {
		method: 'POST',
		body,
		redirect: 'manual',
		headers: { origin: base, ...PROXY }
	});
	const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
	if (!cookie) throw new Error(`could not sign in (${r.status})`);
	return cookie;
};

const cookie = await login();
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
await check(
	'exemption without a certificate is refused',
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
		const okB = b.status === 412;
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
			? r.body.round_trip_miles !== null && r.body.drive_minutes !== null
			: typeof r.body?.why === 'string' &&
				r.body.round_trip_miles === null &&
				r.body.drive_minutes === null)
);
await check(
	'a place not chosen from Google is refused',
	'POST',
	'/api/sites/drive',
	{ fields: { google_place_id: '' } },
	400
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
	{ fields: { name: '', unit: 'hour' } },
	400
);
const svc = await check(
	'a service is made',
	'POST',
	'/api/services',
	{ fields: { name: `Write check ${stamp}`, unit: 'hour' } },
	201
);
const sid = svc.body?.id;
if (sid) {
	const at = `/api/services/${sid}`;
	await check('it renames', 'PATCH', at, { fields: { name: `Checked ${stamp}` } }, 200);
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
		await check('a service with time recorded is not removed', 'DELETE', at, undefined, 409);
		await check('its entry goes', 'DELETE', `/api/time/${hour.body.id}`, undefined, 200);
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

	const listed = await (await fetch(`${base}/services`, { headers: { cookie } })).text();
	const service = [...listed.matchAll(/\/services\/([0-9a-f-]{36})"/g)].map((m) => m[1])[0];
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
			{ fields: { allotment: 'unlimited', included_hours: '9' } },
			(r) => r.status === 200 && r.body?.saved?.included_hours === null
		);
		await check(
			'and changed to a cap, whole',
			'PUT',
			cover,
			{ fields: { allotment: 'capped', included_hours: '6', overage: 'no_charge' } },
			200
		);
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
const peoplePage = await (await fetch(`${base}/settings/people`, { headers: { cookie } })).text();
const person = [...peoplePage.matchAll(/id="set-([0-9a-f-]{36})-role_id"/g)].map((m) => m[1])[0];
const held = optionsOf(peoplePage, `set-${person}-role_id`).find((o) => o.label === 'Partner');
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

// Who is owed, from the pay report; Sam's earlier payment, from Sam's page.
const payPage = await (await fetch(`${base}/reports/pay`, { headers: { cookie } })).text();
const payee = (/** @type {string} */ name) =>
	[
		...payPage.matchAll(
			/href="[^"]*\/reports\/pay\/([0-9a-f-]{36})"[\s\S]*?class="rec-t"[^>]*>(?:\s|<!--[^>]*-->)*([^<&]+)/g
		)
	].find((m) => m[2].trim() === name)?.[1];
const sam = payee('Sam Ortega');
const avery = payee('Avery Lind');
const samPage = sam
	? await (await fetch(`${base}/reports/pay/${sam}`, { headers: { cookie } })).text()
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
const foot = unitsPage
	.split('id="set-')
	.find((chunk) => /^[0-9a-f-]{36}-name"/.test(chunk) && chunk.includes('value="foot"'))
	?.slice(0, 36);
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
const travelPage = await (await fetch(`${base}/settings/travel`, { headers: { cookie } })).text();
const corolla = [
	...travelPage.matchAll(
		/href="[^"]*\/settings\/travel\/vehicles\/([0-9a-f-]{36})"[\s\S]*?class="rec-t"[^>]*>(?:\s|<!--[^>]*-->)*([^<&]+)/g
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
else failures.push('could not find the Corolla on /settings/travel');

// An SVG logo with a script in it, uploaded through the settings form the way
// a browser would, and then asked for by someone who is not signed in. It is
// still served as an image -- the favicon and the installed icon depend on
// that -- but under a policy that runs nothing if it is opened as a page.
{
	const svg =
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>';
	const form = new FormData();
	form.set('logo', new Blob([svg], { type: 'image/svg+xml' }), 'logo.svg');
	const up = await fetch(`${base}/settings/business?/logo`, {
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
	await fetch(`${base}/settings/business?/clearLogo`, {
		method: 'POST',
		body: new FormData(),
		headers: { cookie, origin: base, 'x-sveltekit-action': 'true', ...PROXY }
	});
}

/** The value chosen in the list with this id, as the server drew it. */
const chosen = (/** @type {string} */ html, /** @type {string} */ id) => {
	const list = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html)?.[1];
	return list ? (/<option value="([^"]*)" selected/.exec(list)?.[1] ?? '') : null;
};

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
	// This month so far, on the business's calendar: whichever zone's span the
	// retainer meter is showing. The person reads it in British English, set below.
	const businessDay = async () => {
		const html = await page('/reports/retainers');
		for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
			const d = zoneDay(zone);
			if (html.includes(drawn('en-GB', `${d.slice(0, 8)}01`, d))) return d;
		}
		return null;
	};

	// Who "me" is and somebody who is not, and what their settings were, to put
	// back afterwards. Their zone and locale are in their own profile.
	const people = await page('/settings/people');
	const blocks = people.split(/(?=id="set-[0-9a-f-]{36}-role_id")/);
	const mine = blocks.find((b) => b.includes(email));
	const me = mine && /id="set-([0-9a-f-]{36})-role_id"/.exec(mine)?.[1];
	const other = blocks
		.map((b) => /id="set-([0-9a-f-]{36})-role_id"/.exec(b)?.[1])
		.find((id) => id && id !== me);
	const profile = await page('/profile');
	const before = {
		timezone: chosen(profile, 'set-timezone') ?? '',
		locale: chosen(profile, 'set-locale') ?? '',
		hour_cycle: chosen(profile, 'set-hour_cycle') ?? '',
		week_start: chosen(profile, 'set-week_start') ?? ''
	};
	const business = chosen(await page('/settings/business'), 'set-timezone') || 'UTC';
	const setMine = (/** @type {string} */ name, /** @type {string} */ value) =>
		call('PATCH', `/api/people/${me}`, { fields: { [name]: value } });
	const setOwn = (/** @type {string} */ zone) => setMine('timezone', zone);
	const setBusiness = (/** @type {string} */ zone) =>
		call('PATCH', '/api/settings', { fields: { timezone: zone } });

	if (!me) {
		record(
			false,
			"a person's own zone is theirs",
			'could not find who is signed in on /settings/people'
		);
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
			const k = /Assembled (\d{2}):(\d{2})/.exec(await page(`/invoices/${id}`));
			await setOwn('Pacific/Pago_Pago');
			const p = /Assembled (\d{2}):(\d{2})/.exec(await page(`/invoices/${id}`));
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

		// How their dates read is theirs: the same day, in two locales.
		const today = await formDay();
		if (today) {
			const full = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
			const gb = (await page('/')).includes(
				drawn('en-GB', today, today, /** @type {any} */ (full))
			);
			await setMine('locale', 'en-US');
			const us = (await page('/')).includes(
				drawn('en-US', today, today, /** @type {any} */ (full))
			);
			await setMine('locale', 'en-GB');
			record(
				gb && us,
				"a person's locale is how their dates read",
				`British ${gb}, American ${us} for ${today}`
			);
		}

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

console.log('');
if (failures.length) {
	console.error(`${failures.length} write path(s) failed, ${passed} passed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`${passed} write paths exercised, all as expected.`);
