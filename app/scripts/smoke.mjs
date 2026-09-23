#!/usr/bin/env node
/**
 * Load every page and report what came back.
 *
 * `npm run ci` typechecks and builds; neither runs a query. Two screens shipped
 * with a broken FROM clause that only a request would find, so this makes the
 * request. It is not a test of what a page says -- only that asking for it does
 * not fail.
 *
 *   node scripts/smoke.mjs http://127.0.0.1:5181 email password
 */
const [, , base, email, password] = process.argv;
if (!base) {
	console.error('usage: smoke.mjs <base-url> [email] [password]');
	process.exit(2);
}

// Detail routes need a real row; the smoke run asks the list pages for one.
//
// CLIENTS AND SITES ARE ADDRESSED BY SLUG, not by id. This matched
// [0-9a-f-]{36} until now, which stopped matching the day slugs landed -- so
// four of the six screens below were skipped, printed a dash, and the run still
// said "every route answered". A harness that reports a hole as a pass is worse
// than not having it, which is why a miss is a failure now rather than a note.

/** The first capture that survives `keep`, or null. */
const first = (
	/** @type {string} */ html,
	/** @type {RegExp} */ re,
	keep = (/** @type {string} */ _s) => true
) => [...html.matchAll(re)].map((m) => m[1]).find(keep) ?? null;

// The quote is load-bearing: it ends the href, so /clients/bravo-farms matches
// and /clients/bravo-farms/sites does not. `contacts` and `new` are pages that
// sit where a slug sits.
const aClient = (/** @type {string} */ html) =>
	first(html, /\/clients\/([a-z0-9-]+)"/g, (slug) => slug !== 'contacts' && slug !== 'new');

/** @type {{ list: string; path: (id: string) => string; pick: (html: string) => string | null }[]} */
const DETAIL = [
	{
		list: '/trips',
		path: (id) => `/trips/${id}`,
		pick: (h) => first(h, /\/trips\/([0-9a-f-]{36})/g)
	},
	{
		list: '/invoices',
		path: (id) => `/invoices/${id}`,
		pick: (h) => first(h, /\/invoices\/([0-9a-f-]{36})/g)
	},
	{ list: '/clients', path: (id) => `/clients/${id}`, pick: aClient },
	{ list: '/clients', path: (id) => `/clients/${id}/sites`, pick: aClient },
	{ list: '/clients', path: (id) => `/clients/${id}/sites/new`, pick: aClient },
	{
		list: '/clients/bravo-farms/sites',
		path: (path) => path,
		pick: (h) =>
			first(h, /(\/clients\/[a-z0-9-]+\/sites\/[a-z0-9-]+)"/g, (path) => !path.endsWith('/new'))
	}
];
const ROUTES = [
	'/',
	'/timesheet',
	'/timesheet/manual',
	'/timesheet/start',
	'/timesheet/all',
	'/trips',
	'/invoices',
	'/invoices/ready',
	'/unbilled',
	'/more',
	'/clients',
	'/clients/contacts',
	'/catalogue',
	'/catalogue/materials',
	'/catalogue/agreements',
	'/services',
	'/reports',
	'/reports/schedule-a',
	'/reports/partner-pay',
	'/reports/remote',
	'/settings',
	'/settings/business',
	'/settings/invoicing',
	'/settings/tax',
	'/settings/people',
	'/settings/travel',
	'/settings/integrations'
];

let cookie = '';

if (email) {
	const body = new URLSearchParams({ email, password: password ?? '', next: '/' });
	const r = await fetch(base + '/login', {
		method: 'POST',
		body,
		redirect: 'manual',
		headers: { origin: base }
	});
	cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
	if (!cookie) {
		console.error(`  could not sign in (${r.status}) -- every route will read as signed out`);
		process.exit(1);
	}

	// A signed-out request gets the login page back with a 200, so every route
	// would "answer" while proving nothing. Check that a route behind the wall
	// actually shows what is behind it before trusting any of the rest.
	const probe = await fetch(base + '/settings', { headers: { cookie } });
	const behind = await probe.text();
	if (probe.status !== 200 || /name="password"/.test(behind)) {
		console.error('  signed in but still being shown the login page -- is the password set?');
		process.exit(1);
	}
}

let bad = 0;
for (const path of ROUTES) {
	let line;
	try {
		const r = await fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
		const mark = r.status < 400 ? '✓' : '✗';
		if (r.status >= 400) bad++;
		line = `  ${mark} ${String(r.status).padEnd(3)} ${path}`;
	} catch (e) {
		bad++;
		line = `  ✗ ERR ${path}  ${e instanceof Error ? e.message : String(e)}`;
	}
	console.log(line);
}

// Follow one row into each detail screen, which is where the list pages point.
for (const d of DETAIL) {
	const html = await (await fetch(base + d.list, { headers: cookie ? { cookie } : {} })).text();
	const found = d.pick(html);
	if (found === null) {
		// Not "nothing to do". The seed puts rows on every one of these pages,
		// so finding none means the link shape changed and this screen is no
		// longer being opened by anything.
		bad++;
		console.log(`  ✗ ${d.list} offered no row to open -- ${d.path('<row>')} went unchecked`);
		continue;
	}
	const r = await fetch(base + d.path(found), { headers: cookie ? { cookie } : {} });
	if (r.status >= 400) bad++;
	console.log(`  ${r.status < 400 ? '✓' : '✗'} ${String(r.status).padEnd(3)} ${d.path(found)}`);
}

console.log(bad === 0 ? '\n  every route answered' : `\n  ${bad} route(s) failed`);
process.exit(bad === 0 ? 0 : 1);
