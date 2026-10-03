#!/usr/bin/env node
/**
 * Exercises everything that WRITES, and checks what it wrote.
 *
 *   node scripts/write-check.mjs <base-url> <email> <password>
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
	const made = await call('POST', `/api/clients/${clientSlug}/sites`, {
		fields: {
			label: `Write check ${stamp}`,
			street: '526 C St',
			city: 'Marysville',
			region: 'CA',
			postcode: '95901'
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

console.log('\n  roles — named, renamed, and taken away again');

await check(
	'a role with no name is refused',
	'POST',
	'/api/roles',
	{ fields: { name: '  ' } },
	400
);
const role = await check(
	'a role is added',
	'POST',
	'/api/roles',
	{ fields: { name: `Check ${stamp}` } },
	201
);
await check(
	'the same name twice is refused',
	'POST',
	'/api/roles',
	{ fields: { name: `Check ${stamp}` } },
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

console.log('');
if (failures.length) {
	console.error(`${failures.length} write path(s) failed, ${passed} passed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`${passed} write paths exercised, all as expected.`);
