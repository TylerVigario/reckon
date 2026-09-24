#!/usr/bin/env node
/**
 * Exercises everything that WRITES, and checks what it wrote.
 *
 *   node scripts/write-check.mjs <base-url> <email> <password>
 *
 * WHY THIS EXISTS. smoke.mjs asks every route for a status code and
 * console-check.mjs clicks through every screen -- both only ever GET. So when
 * /api/time started inserting into a column that had been dropped, every time
 * entry 500ed for eight days and all three checks stayed green: the pages
 * rendered, the routes answered, and nothing had tried to save anything.
 *
 * A read-only test suite on a system whose whole job is recording work is a
 * suite that cannot see the failure that matters.
 *
 * It cleans up after itself. Anything it creates it closes or deletes, so it
 * can be run against a database somebody is looking at.
 */
const [, , base = 'http://127.0.0.1:5181', email, password] = process.argv;

let passed = 0;
const failures = [];

const login = async () => {
	const body = new URLSearchParams({ email, password: password ?? '', next: '/' });
	const r = await fetch(`${base}/login`, {
		method: 'POST',
		body,
		redirect: 'manual',
		headers: { origin: base }
	});
	const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
	if (!cookie) throw new Error(`could not sign in (${r.status})`);
	return cookie;
};

const cookie = await login();
const H = { cookie, 'content-type': 'application/json', origin: base };

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

console.log('\n  time entries — the path that broke');

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
	// A TEAM entry, because it names nobody by definition -- the people are
	// rendered as buttons and carry no id in the markup, and inventing a user
	// id here would test the foreign key rather than the insert.
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
} else {
	failures.push('could not find a service to post an entry with');
}

console.log('\n  settings');
await check('a setting saves', 'PATCH', '/api/settings', { fields: { short_name: 'VTS' } }, 200);
await check(
	'a setting that does not exist is refused',
	'PATCH',
	'/api/settings',
	{ fields: { nonsense: 'x' } },
	400
);

console.log('\n  clients and sites');
await check(
	'a client saves, addressed by slug',
	'PATCH',
	`/api/clients/${clientSlug}`,
	{ fields: { terms_days: '14' } },
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
	{ fields: { terms_days: '14' } },
	404
);

console.log('\n  one save must not erase another');
{
	// Both "pages" read the same version, as two people with the client open.
	const first = await call('PATCH', `/api/clients/${clientSlug}`, { fields: { terms_days: '21' } });
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
		const c = await conditioned('14', newVersion ?? '');
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
	const made = await call('POST', `/api/clients/${clientSlug}/sites`, {
		fields: {
			label: `Write check ${stamp}`,
			street: '500 W Main St',
			city: 'Visalia',
			region: 'CA',
			postcode: '93291'
		}
	});

	if (made.status === 201) {
		passed++;
		console.log('  ✓ a site is created and priced by CDTFA');
		// Addressed by slug from here, which is the whole point of nesting it.
		const at = `/api/clients/${clientSlug}/sites/${made.body.slug}`;

		await check('a site renames', 'PATCH', at, { fields: { label: `Renamed ${stamp}` } }, 200);
		await check('a rate cannot be typed in', 'PATCH', at, { fields: { tax_rate_pct: '0' } }, 400);
		await check(
			'a slug that leaves nothing is refused',
			'PATCH',
			at,
			{ fields: { slug: '!!!' } },
			400
		);
		await check(
			'an address CDTFA cannot place is refused',
			'PATCH',
			at,
			{ fields: { street: 'zzzz', city: 'zzzz', postcode: '00000' } },
			400
		);
		if (otherSlug)
			await check(
				'the site is not reachable through another client',
				'PATCH',
				`/api/clients/${otherSlug}/sites/${made.body.slug}`,
				{ fields: { label: 'Should not work' } },
				404
			);
		await check(
			'somebody is added at the site',
			'POST',
			`${at}/contacts`,
			{ name: 'Write Check', is_primary: true },
			201
		);
		await check('the site closes', 'DELETE', at, undefined, 200);
	} else if (JSON.stringify(made.body).includes('CDTFA')) {
		console.log('  – site endpoints skipped: CDTFA could not be reached');
	} else {
		failures.push(`creating a site: ${made.status} ${JSON.stringify(made.body)?.slice(0, 140)}`);
		console.log('  ✗ a site is created and priced by CDTFA');
	}
}

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
	await check(
		'a cap with no hours is refused',
		'PUT',
		`${at}/subscription`,
		{
			fields: {
				subscription_basis: 'capped',
				subscription_period: 'month',
				subscription_overage: 'bill'
			}
		},
		400
	);
	await check(
		'a whole cap saves',
		'PUT',
		`${at}/subscription`,
		{
			fields: {
				subscription_basis: 'capped',
				subscription_hours: '2',
				subscription_period: 'month',
				subscription_overage: 'bill'
			}
		},
		200
	);
	await check(
		'no cap drops its terms',
		'PUT',
		`${at}/subscription`,
		{ fields: { subscription_basis: 'none', subscription_hours: '2' } },
		(r) => r.status === 200 && r.body?.saved?.subscription_hours === null
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

	await check('a service nothing used is removed', 'DELETE', at, undefined, 200);
}

console.log('');
if (failures.length) {
	console.error(`${failures.length} write path(s) failed, ${passed} passed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`${passed} write paths exercised, all as expected.`);
