#!/usr/bin/env node
/**
 * Load every page and report what came back.
 *
 * `npm run ci` typechecks and builds; neither runs a query. A broken FROM clause
 * is only found by a request, so this makes the request. It is not a test of
 * what a page says -- only that asking for it does not fail.
 *
 *   node tests/smoke.mjs http://127.0.0.1:5181 email password
 */
const [, , base, email, password] = process.argv;

// In production a TLS proxy stands in front, and the server takes the scheme
// from it. Over plain http this says what that proxy would -- the server is
// started with PROTOCOL_HEADER=x-forwarded-proto to read it. Without it the
// server assumes https, and refuses every form post as cross-site.
/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};
if (!base) {
	console.error('usage: smoke.mjs <base-url> [email] [password]');
	process.exit(2);
}

// Detail routes need a real row; the smoke run asks the list pages for one.
//
// CLIENTS AND SITES ARE ADDRESSED BY SLUG, not by id. A pattern that stops
// matching would skip screens, print a dash, and still say "every route
// answered". A harness that reports a hole as a pass is worse than not having
// it, which is why a miss is a failure rather than a note.

/** The first capture that survives `keep`, or null. */
const first = (
	/** @type {string} */ html,
	/** @type {RegExp} */ re,
	keep = (/** @type {string} */ _s) => true
) => [...html.matchAll(re)].map((m) => m[1]).find(keep) ?? null;

// The quote is load-bearing: it ends the href, so /clients/harbor-light-dental matches
// and /clients/harbor-light-dental/sites does not. `contacts` and `new` are pages that
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
	{
		list: '/catalogue/agreements',
		path: (id) => `/catalogue/agreements/${id}`,
		pick: (h) => first(h, /\/catalogue\/agreements\/([0-9a-f-]{36})"/g)
	},
	{
		list: '/services',
		path: (id) => `/services/${id}`,
		pick: (h) => first(h, /\/services\/([0-9a-f-]{36})"/g)
	},
	{
		list: '/services',
		path: (id) => `/services/${id}/history`,
		pick: (h) => first(h, /\/services\/([0-9a-f-]{36})"/g)
	},
	{ list: '/clients', path: (id) => `/clients/${id}`, pick: aClient },
	{ list: '/clients', path: (id) => `/clients/${id}/sites`, pick: aClient },
	{ list: '/clients', path: (id) => `/clients/${id}/sites/new`, pick: aClient },
	{
		list: '/clients/harbor-light-dental/sites',
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
	'/profile',
	'/clients',
	'/clients/contacts',
	'/catalogue',
	'/catalogue/materials',
	'/catalogue/agreements',
	'/catalogue/agreements/new',
	'/services',
	'/services/new',
	'/reports',
	'/reports/schedule-a',
	'/reports/pay',
	'/reports/retainers',
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
		headers: { origin: base, ...PROXY }
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

// Signed out, the operator's stylesheet must come back as a stylesheet: the
// sign-in page links it, and a redirect to the sign-in page here is HTML the
// browser refuses to apply.
{
	const r = await fetch(base + '/operator/theme.css', { headers: PROXY, redirect: 'manual' });
	const ok = r.status === 200 && (r.headers.get('content-type') ?? '').startsWith('text/css');
	if (!ok) bad++;
	console.log(`  ${ok ? '✓' : '✗'} ${String(r.status).padEnd(3)} /operator/theme.css, signed out`);
}

// A sign-in link whose next names another site, as a browser reads
// "/\example.com". Signing in through it, and opening it while signed in,
// both land at home -- not off the site, and not on an error page.
if (email) {
	const crafted = '/\\example.com/';
	const signingIn = await fetch(base + '/login', {
		method: 'POST',
		body: new URLSearchParams({ email, password: password ?? '', next: crafted }),
		redirect: 'manual',
		// As a browser's form post asks: otherwise SvelteKit answers in JSON,
		// with the redirect described inside a 200.
		headers: { origin: base, accept: 'text/html', ...PROXY }
	});
	const signedIn = await fetch(`${base}/login?next=${encodeURIComponent(crafted)}`, {
		headers: { cookie, ...PROXY },
		redirect: 'manual'
	});
	for (const [when, r] of /** @type {[string, Response][]} */ ([
		['signing in', signingIn],
		['already signed in', signedIn]
	])) {
		const to = new URL(r.headers.get('location') ?? '', base).href;
		const ok = r.status === 303 && to === new URL('/', base).href;
		if (!ok) bad++;
		console.log(
			`  ${ok ? '✓' : '✗'} ${String(r.status).padEnd(3)} a sign-in link to another site, ${when}, goes home`
		);
	}
}
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
