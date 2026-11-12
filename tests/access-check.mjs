#!/usr/bin/env node
/**
 * Proves what each access level reaches (#lib/access), signed in as someone
 * with Full and someone with Field.
 *
 *   node tests/access-check.mjs <base-url> <full-email> <field-email>
 *
 * Each signed in with the passkey tests/passkeys.mjs gave them.
 *
 * Every route Field does not reach is refused to them before it runs -- a
 * screen turned away to /refused, an endpoint answered with a 403 problem
 * document. Every route in the table is asked, its ids filled in with anything,
 * since the refusal comes before the route looks at them. Every screen Field
 * does reach opens.
 *
 * Where Field reaches, it sees its own: drafts and nothing sent, the trips
 * they drove, their own pay, a client without what it owes. It records time
 * only for work it was on, removes only an entry it entered, changes only a
 * line it added, and changes nobody's access, its own included. And someone
 * keeps Full: the only one with it cannot give it up.
 *
 * What is compared is what each of the two is shown, not ids from the seed. It
 * leaves nothing it made.
 */
import { REACH } from '../src/lib/access.ts';
import { signIn } from './passkeys.mjs';

const [, , base, fullEmail, fieldEmail] = process.argv;
if (!base || !fullEmail || !fieldEmail) {
	console.error('usage: node tests/access-check.mjs <base-url> <full-email> <field-email>');
	process.exit(2);
}

// In production a TLS proxy stands in front, and the server takes the scheme
// from it. Over plain http this says what that proxy would.
/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

let passed = 0;
/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what, detail = '') => {
	if (ok) passed++;
	else failures.push(detail ? `${what}: ${detail}` : what);
	console.log(`  ${ok ? '✓' : '✗'} ${what}`);
};

/** @typedef {(path: string, init?: RequestInit) => Promise<Response>} Ask */
const as = (/** @type {string} */ cookie) =>
	/** @type {Ask} */ (
		(path, init = {}) =>
			fetch(base + path, {
				redirect: 'manual',
				...init,
				headers: { cookie, origin: base, ...PROXY, ...(init.headers ?? {}) }
			})
	);
const asFull = as((await signIn(base, fullEmail)).cookie);
const asField = as((await signIn(base, fieldEmail)).cookie);

const page = async (/** @type {Ask} */ ask, /** @type {string} */ path) => (await ask(path)).text();
const send = (/** @type {string} */ method, /** @type {unknown} */ body) => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});
/** The problem document a refusal carries, or null. */
const problemOf = async (/** @type {Response} */ r) =>
	(r.headers.get('content-type') ?? '').startsWith('application/problem+json')
		? /** @type {{ type?: string; errors?: Record<string, string> }} */ (await r.json())
		: null;
/**
 * Every id in what a page links to under `under`, as each person was shown it.
 * A link is written relative to the page it is on -- "./trips/...",
 * "../trips/..." -- so it is found by where it ends, not where it starts.
 */
const linked = (/** @type {string} */ html, /** @type {string} */ under) =>
	new Set([...html.matchAll(new RegExp(`${under}/([0-9a-f-]{36})"`, 'g'))].map((m) => m[1]));
const uuid = () => crypto.randomUUID();

// ------------------------------------------------------------ the table ----

// Every route beyond Field, refused before it runs. Ids are anything: a route
// that looked at them first would have run.
{
	const ANY = '01a1a81d-0000-7000-8000-000000000000';
	/** @type {string[]} */
	const through = [];
	let asked = 0;
	for (const [route, need] of Object.entries(REACH)) {
		if (need !== 'full') continue;
		asked++;
		const path = route.replace(/\[[^\]]+\]/g, ANY);
		const r = await asField(path);
		const refused = route.startsWith('/api/')
			? r.status === 403 && (await problemOf(r))?.type === '/problems/beyond-access'
			: r.status === 303 && r.headers.get('location') === '/refused';
		if (!refused) through.push(`${path} ${r.status}`);
	}
	check(
		through.length === 0,
		`all ${asked} routes beyond Field are refused before they run`,
		through.join(', ')
	);
}

// The data a screen is drawn from is turned away too, and a write as well as a read.
{
	const data = await asField('/reports/schedule-a/__data.json');
	const body = await data.text();
	check(
		data.status === 200 && body.includes('"redirect"') && body.includes('/refused'),
		"a screen's data is turned away to /refused",
		`${data.status} ${body.slice(0, 120)}`
	);
	const pay = await asField('/api/pay', send('POST', {}));
	check(
		pay.status === 403 && (await problemOf(pay))?.type === '/problems/beyond-access',
		'recording a payment is refused to Field',
		String(pay.status)
	);
	check(
		pay.headers.get('x-content-type-options') === 'nosniff' &&
			/sandbox/.test(pay.headers.get('content-security-policy') ?? ''),
		'and the refusal carries the headers every answer does'
	);
	const settings = await asFull('/settings');
	check(
		settings.status === 200,
		'and Full still reaches what Field does not',
		String(settings.status)
	);
}

// Every screen Field reaches opens, and the refusal says why.
{
	const screens = Object.entries(REACH)
		.filter(
			([route, need]) =>
				need === 'field' &&
				!route.startsWith('/api/') &&
				!route.includes('[') &&
				route !== '/logout'
		)
		.map(([route]) => route);
	/** @type {string[]} */
	const shut = [];
	for (const path of screens) {
		const r = await asField(path);
		if (r.status !== 200) shut.push(`${path} ${r.status}`);
	}
	check(shut.length === 0, `all ${screens.length} screens Field reaches open`, shut.join(', '));
	const refused = await page(asField, '/refused');
	check(refused.includes('You have Field access'), 'the refusal says what Field reaches');
}

// ---------------------------------------------------------- their own ----

const [fullMore, fieldMore, fullPay] = await Promise.all([
	page(asFull, '/more'),
	page(asField, '/more'),
	page(asFull, '/reports/pay')
]);

// Who is who, by name, as the pay report lists them.
/** @type {Record<string, string>} */
const idOf = {};
for (const chunk of fullPay.split('/reports/pay/').slice(1)) {
	const name = /class="rec-t">\s*([^<&]+)/.exec(chunk)?.[1]?.trim();
	if (name && /^[0-9a-f-]{36}"/.test(chunk)) idOf[name] = chunk.slice(0, 36);
}
const me = [...linked(fieldMore, '/reports/pay')][0];
const others = Object.values(idOf).filter((id) => id !== me);
check(!!me && others.length >= 2, 'Field has their own pay under More, and others are paid');
check(!linked(fullMore, '/reports/pay').size, 'Full reaches pay through the reports instead');

for (const tab of ['', '/paid']) {
	const own = await asField(`/reports/pay/${me}${tab}`);
	const said = tab ? 'payments made to them' : 'pay';
	check(own.status === 200, `Field opens their own ${said}`, String(own.status));
	const theirs = await Promise.all(others.map((id) => asField(`/reports/pay/${id}${tab}`)));
	check(
		theirs.every((r) => r.status === 404),
		"and not anyone else's",
		theirs.map((r) => r.status).join(', ')
	);
}

{
	const today = await page(asField, '/');
	check(
		today.includes('Owed to you') && !today.includes('Sales tax held'),
		"Field's Today is their own, without the business's figures"
	);
}

// Invoices: drafts, and nothing that has gone out.
{
	const [all, drafts] = await Promise.all([
		page(asFull, '/invoices'),
		page(asField, '/invoices')
	]).then(([a, b]) => [linked(a, '/invoices'), linked(b, '/invoices')]);
	const sent = [...all].filter((id) => !drafts.has(id));
	check(
		drafts.size > 0 && [...drafts].every((id) => all.has(id)) && sent.length > 0,
		'Field is shown the drafts, and Full what has gone out besides'
	);
	const opened = await Promise.all(sent.map((id) => asField(`/invoices/${id}`)));
	check(
		opened.every((r) => r.status === 404),
		'an invoice that has gone out does not open for Field',
		opened.map((r) => r.status).join(', ')
	);
	// Nor through the page that adds a line, fixing a refused one or not.
	const adding = await Promise.all(
		sent.flatMap((id) => [asField(`/invoices/${id}/add`), asField(`/invoices/${id}/add?fix=1`)])
	);
	check(
		adding.every((r) => r.status === 404),
		'nor does its page for adding a line, ?fix or not',
		adding.map((r) => r.status).join(', ')
	);
	const fixing = await asFull(`/invoices/${sent[0]}/add?fix=1`);
	check(fixing.status === 200, 'Full still opens it to fix a refused line', String(fixing.status));
}

// Trips: the ones they drove, this month and the two before it.
{
	const now = new Date();
	const months = [0, 1, 2].map((back) =>
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7)
	);
	/** @type {Set<string>} */
	const all = new Set();
	/** @type {Set<string>} */
	const theirs = new Set();
	for (const month of months) {
		for (const id of linked(await page(asFull, `/trips?month=${month}`), '/trips')) all.add(id);
		for (const id of linked(await page(asField, `/trips?month=${month}`), '/trips')) theirs.add(id);
	}
	const notTheirs = [...all].filter((id) => !theirs.has(id));
	check(
		[...theirs].every((id) => all.has(id)) && notTheirs.length > 0,
		'Field is shown the trips they drove, and Full every trip'
	);
	const opened = await Promise.all(notTheirs.map((id) => asField(`/trips/${id}`)));
	check(
		opened.every((r) => r.status === 404),
		'a trip someone else drove does not open for Field',
		opened.map((r) => r.status).join(', ')
	);
}

// A client, without what it owes.
{
	const clients = await page(asFull, '/clients');
	const slug = [...clients.matchAll(/\/clients\/([a-z0-9-]+)"/g)]
		.map((m) => m[1])
		.find((x) => x !== 'contacts' && x !== 'new');
	// Details is billing, tax and invoices, all Full's: Field opens a client on
	// its Sites, and its head says nothing of what it owes.
	const [toFull, fieldDetails, sitesFull, sitesField, contactsFull, contactsField] =
		await Promise.all([
			page(asFull, `/clients/${slug}`),
			asField(`/clients/${slug}`),
			page(asFull, `/clients/${slug}/sites`),
			page(asField, `/clients/${slug}/sites`),
			page(asFull, `/clients/${slug}/contacts`),
			page(asField, `/clients/${slug}/contacts`)
		]);
	check(
		toFull.includes('Unapplied credit') &&
			fieldDetails.status === 307 &&
			(fieldDetails.headers.get('location') ?? '').endsWith(`/clients/${slug}/sites`),
		'Field opens a client on its sites, without its billing',
		`${fieldDetails.status} ${fieldDetails.headers.get('location')}`
	);
	check(
		// As the head words it: the page's own data names the field either way.
		/Nothing owed|owed · \d/.test(sitesFull) && !/Nothing owed|owed · \d/.test(sitesField),
		'nor what it owes, at the head of every tab'
	);
	check(
		contactsFull.includes('Invoices go to') &&
			!contactsField.includes('Invoices go to') &&
			contactsField.includes('/clients/contacts/'),
		"Field reads a client's contacts, and not who the invoices go to"
	);

	// A contact, to read: nothing changed, and not whose invoices go to them.
	const people = [
		...new Set(
			[...contactsFull.matchAll(/\/clients\/contacts\/([0-9a-f-]{36})"/g)].map((m) => m[1])
		)
	];
	const pages = await Promise.all(
		people.map(async (id) => ({
			full: await page(asFull, `/clients/contacts/${id}`),
			field: await page(asField, `/clients/contacts/${id}`)
		}))
	);
	const bills = pages.find((p) => p.full.includes('Gets invoices'));
	check(
		!!bills &&
			bills.full.includes('aria-label="Edit email"') &&
			!bills.field.includes('aria-label="Edit email"') &&
			!bills.field.includes('Gets invoices') &&
			!bills.field.includes('invoices are sent here'),
		'Field reads a contact, changes nothing, and is not told whose invoices go to them'
	);
	const [listFull, listField] = await Promise.all([
		page(asFull, '/clients/contacts'),
		page(asField, '/clients/contacts')
	]);
	check(
		listFull.includes('gets invoices') && !listField.includes('gets invoices'),
		'nor on the list of contacts'
	);
}

// ------------------------------------------------------------- writing ----

const manual = await page(asField, '/timesheet/manual');
const service = /<select[^>]*id="m-service"[^>]*>[\s\S]*?<option value="([0-9a-f-]{36})"/.exec(
	manual
)?.[1];
const full = idOf['Avery Lind'];
const third = Object.values(idOf).find((id) => id !== me && id !== full);
const entry = (/** @type {Record<string, unknown>} */ extra) => ({
	client_uuid: uuid(),
	worked_on: new Date().toISOString().slice(0, 10),
	minutes: 30,
	service_id: service,
	billable: false,
	...extra
});

// Time: only work they were on, and only what they entered comes off.
{
	const alone = await asField('/api/time', send('POST', entry({ crew: 'one', worked_by: full })));
	check(
		alone.status === 400 && !!(await problemOf(alone))?.errors?.worked_by,
		"Field cannot enter someone else's work",
		String(alone.status)
	);
	const crew = await asField(
		'/api/time',
		send('POST', entry({ crew: 'team', crew_ids: [full, third] }))
	);
	check(
		crew.status === 400 && !!(await problemOf(crew))?.errors?.crew_ids,
		'nor a team they were not on',
		String(crew.status)
	);

	const mine = await asField('/api/time', send('POST', entry({ crew: 'one', worked_by: me })));
	const mineId = mine.ok ? (await mine.json()).id : null;
	const off = mineId ? await asField(`/api/time/${mineId}`, { method: 'DELETE' }) : null;
	check(
		mine.ok && off?.status === 200,
		'Field enters their own work, and takes it off',
		`${mine.status} ${off?.status}`
	);

	const team = await asFull(
		'/api/time',
		send('POST', entry({ crew: 'team', crew_ids: [full, me] }))
	);
	const teamId = team.ok ? (await team.json()).id : null;
	const refused = teamId ? await asField(`/api/time/${teamId}`, { method: 'DELETE' }) : null;
	check(
		team.ok &&
			refused?.status === 403 &&
			(await problemOf(refused))?.type === '/problems/not-yours',
		'team work someone else entered is theirs to take off',
		`${team.status} ${refused?.status}`
	);
	if (teamId) await asFull(`/api/time/${teamId}`, { method: 'DELETE' });

	// The uuid a phone makes is its maker's own: sent by anyone else, it
	// neither hands back what the first one made nor is taken for it.
	const shared = uuid();
	const first = await asFull(
		'/api/time',
		send('POST', entry({ client_uuid: shared, crew: 'one', worked_by: full, minutes: 45 }))
	);
	const firstId = first.ok ? (await first.json()).id : null;
	const again = await asField(
		'/api/time',
		send('POST', entry({ client_uuid: shared, crew: 'one', worked_by: me }))
	);
	const theirs = again.ok ? await again.json() : null;
	check(
		!!firstId && !!theirs?.id && theirs.id !== firstId && theirs.seconds === 30 * 60,
		"someone else's uuid gives Field an entry of their own, not the other's",
		`${first.status} ${again.status} ${theirs?.id === firstId ? 'the same entry' : ''}`
	);
	if (theirs?.id) await asField(`/api/time/${theirs.id}`, { method: 'DELETE' });
	if (firstId) await asFull(`/api/time/${firstId}`, { method: 'DELETE' });
}

// Lines: added to a draft, and changed or taken off only by whoever added them.
{
	const draft = [...linked(await page(asField, '/invoices'), '/invoices')][0];
	const line = (/** @type {string} */ description) => {
		const f = new FormData();
		f.set('client_uuid', uuid());
		f.set('invoice_id', draft);
		f.set('kind', 'paid_for');
		f.set('description', description);
		f.set('ex_tax_cost', '6.00');
		f.set('bought_from', 'City lot');
		return { method: 'POST', body: f };
	};
	const change = (/** @type {string} */ description) => {
		const f = new FormData();
		f.set('kind', 'paid_for');
		f.set('description', description);
		f.set('ex_tax_cost', '7.00');
		f.set('bought_from', 'City lot');
		return { method: 'PATCH', body: f };
	};
	const added = await asField('/api/lines', line('Parking at the job'));
	const mine = added.ok ? (await added.json()).id : null;
	const theirs = await asFull('/api/lines', line('Parking, the second day'));
	const other = theirs.ok ? (await theirs.json()).id : null;
	check(added.ok && theirs.ok, 'Field adds a line to a draft', `${added.status} ${theirs.status}`);

	const changed = mine
		? await asField(`/api/lines/${mine}`, change('Parking at the clinic'))
		: null;
	check(changed?.status === 200, 'and changes the line they added', String(changed?.status));
	const [notChanged, notOff] = other
		? await Promise.all([
				asField(`/api/lines/${other}`, change('Not theirs')),
				asField(`/api/lines/${other}`, { method: 'DELETE' })
			])
		: [null, null];
	check(
		notChanged?.status === 403 && notOff?.status === 403,
		'but not one someone else added',
		`${notChanged?.status} ${notOff?.status}`
	);
	const [mineOff, otherOff] = await Promise.all([
		mine ? asField(`/api/lines/${mine}`, { method: 'DELETE' }) : null,
		other ? asFull(`/api/lines/${other}`, { method: 'DELETE' }) : null
	]);
	check(
		mineOff?.status === 200 && otherOff?.status === 200,
		'and each takes off their own',
		`${mineOff?.status} ${otherOff?.status}`
	);
}

// Access: Full's to change, and someone keeps it.
{
	const people = (/** @type {Record<string, string>} */ fields) => send('PATCH', { fields });
	const [up, down] = await Promise.all([
		asField(`/api/people/${me}`, people({ access: 'full' })),
		asField(`/api/people/${full}`, people({ access: 'field' }))
	]);
	check(
		up.status === 403 && down.status === 403,
		"Field changes nobody's access, their own included",
		`${up.status} ${down.status}`
	);
	const own = await asField(`/api/people/${me}`, people({ week_start: '1' }));
	await asField(`/api/people/${me}`, people({ week_start: '' }));
	check(own.status === 200, 'and still sets their own profile', String(own.status));

	const last = await asFull(`/api/people/${full}`, people({ access: 'field' }));
	check(
		last.status === 400 && !!(await problemOf(last))?.errors?.access,
		'the only one with Full cannot give it up',
		String(last.status)
	);
	const given = await asFull(`/api/people/${third}`, people({ access: 'full' }));
	const back = await asFull(`/api/people/${third}`, people({ access: 'field' }));
	check(
		given.status === 200 && back.status === 200,
		'Full gives Full to someone else, and takes it back',
		`${given.status} ${back.status}`
	);
}

console.log('');
if (failures.length) {
	console.error(`${failures.length} of ${passed + failures.length} failed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`${passed} checks of what each level reaches passed.`);
