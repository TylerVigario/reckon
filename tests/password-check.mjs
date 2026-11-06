#!/usr/bin/env node
/**
 * Proves a person's password goes from one handed over to their own, and is
 * theirs to change: a person added on Team, or whose password is reset there,
 * signs in with the password handed over and must choose their own before
 * anything else opens (#lib/server/handover), and changes it on Your profile
 * with the current one.
 *
 *   node tests/password-check.mjs <base-url> <full-email> <full-password>
 *
 * Someone with Full adds a person and is answered with a password, once. That
 * person signs in with it and reaches nothing but /new-password -- a screen is
 * sent there, an endpoint refused -- where the temporary password itself, one
 * too short and two that differ are each refused. Choosing one keeps that
 * browser signed in and signs out any other that used the temporary one; the
 * temporary one stops working and theirs works. Changing it at
 * /profile/password refuses a current password that isn't theirs, gives that
 * browser a new session and signs out every other, and only the new one signs
 * in. A reset signs them out everywhere and hands over another; nobody resets
 * their own.
 *
 * Over HTTP, the way a browser does it. Needs the database the server uses, to
 * take away the person it added: it leaves nothing it made.
 */
import pg from 'pg';

const [, , base, fullEmail, fullPassword] = process.argv;
if (!base || !fullEmail || !fullPassword) {
	console.error('usage: node tests/password-check.mjs <base-url> <full-email> <full-password>');
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

/** The session cookie a response sets, or '' when it sets none. */
const sessionOf = (/** @type {Response} */ r) =>
	(r.headers.getSetCookie?.() ?? [])
		.map((c) => c.split(';')[0])
		.filter((c) => c.includes('session_token='))
		.join('; ');
/** The session cookie a sign-in sets, or '' when it was refused. */
const signIn = async (/** @type {string} */ email, /** @type {string} */ password) =>
	sessionOf(
		await fetch(`${base}/login`, {
			method: 'POST',
			body: new URLSearchParams({ email, password, next: '/' }),
			redirect: 'manual',
			headers: { origin: base, ...PROXY }
		})
	);

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
/** Where a redirect sends someone, as a path. */
const to = (/** @type {Response} */ r) =>
	r.status === 303 ? new URL(r.headers.get('location') ?? '', base).pathname : null;
// A form posted as a browser posts one: without accept, SvelteKit answers as it
// does an enhanced form, in JSON, and a redirect is a 200.
const post = (
	/** @type {Ask} */ ask,
	/** @type {string} */ path,
	/** @type {Record<string, string>} */ fields
) =>
	ask(path, {
		method: 'POST',
		body: new URLSearchParams(fields),
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }
	});
const choose = (/** @type {Ask} */ ask, /** @type {string} */ password, confirm = password) =>
	post(ask, '/new-password', { password, confirm });
const change = (
	/** @type {Ask} */ ask,
	/** @type {string} */ current,
	/** @type {string} */ password,
	confirm = password
) => post(ask, '/profile/password', { current, password, confirm });
const FOUR_WORDS = /^[a-z]+(-[a-z]+){3}$/;
/** What a password handed over looks like, for a failure to say without printing it. */
const shape = (/** @type {string} */ p) => (FOUR_WORDS.test(p) ? 'four words' : 'not four words');

const db = process.env.DATABASE_URL
	? new pg.Client({ connectionString: process.env.DATABASE_URL })
	: new pg.Client({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev'
		});
await db.connect();

const fullCookie = await signIn(fullEmail, fullPassword);
if (!fullCookie) {
	console.error(`  could not sign in as ${fullEmail}`);
	process.exit(1);
}
const asFull = as(fullCookie);
const email = `handover-${crypto.randomUUID().slice(0, 8)}@kestrel.example`;
/** @type {string | null} */
let id = null;

try {
	// ---------------------------------------------------------- adding ----
	const added = await asFull(
		'/api/people',
		send('POST', { fields: { name: 'Quinn Harper', email, role_id: '', access: 'field' } })
	);
	const made = added.status === 201 ? await added.json() : null;
	id = made?.id ?? null;
	const handed = made?.password ?? '';
	check(
		added.status === 201 && !!id && FOUR_WORDS.test(handed),
		'adding a person answers with four words to hand them',
		`${added.status}, ${shape(handed)}`
	);
	check(
		added.headers.get('cache-control') === 'no-store',
		'and nothing between keeps the answer',
		String(added.headers.get('cache-control'))
	);
	const again = await asFull(
		'/api/people',
		send('POST', { fields: { name: 'Quinn Again', email, role_id: '', access: 'field' } })
	);
	check(
		again.status === 400 && !!(await problemOf(again))?.errors?.email,
		'an email someone already signs in with is refused',
		String(again.status)
	);
	if (!id) throw new Error('nobody was added, so nothing after it can be asked');
	const team = await (await asFull('/team')).text();
	check(/Quinn Harper[\s\S]*?Invited/.test(team), 'Team says they are Invited before they sign in');

	// ------------------------------------------ signed in with it, held ----
	const first = await signIn(email, handed);
	const second = await signIn(email, handed);
	check(!!first && !!second, 'they sign in with it, in two browsers');
	let asThem = as(first);
	const home = await asThem('/');
	check(to(home) === '/new-password', 'a screen sends them to choose a password', `${home.status}`);
	const api = await asThem('/api/time');
	check(
		api.status === 403 && (await problemOf(api))?.type === '/problems/choose-password',
		'and an endpoint is refused, saying why',
		String(api.status)
	);
	const choosing = await asThem('/new-password');
	check(
		choosing.status === 200 && (await choosing.text()).includes('Choose a new password'),
		'the page to choose it opens'
	);

	const short = await choose(asThem, 'too-short');
	check(short.status === 400, 'a password shorter than twelve is refused', String(short.status));
	const differ = await choose(asThem, 'a-password-of-mine', 'a-password-of-yours');
	check(differ.status === 400, 'two that differ are refused', String(differ.status));
	const same = await choose(asThem, handed);
	check(
		same.status === 400 && (await same.text()).includes('temporary password'),
		'the temporary one is refused as theirs',
		String(same.status)
	);

	// ---------------------------------------------------- their own ----
	const own = 'a-password-of-their-own';
	const chosen = await choose(asThem, own);
	check(to(chosen) === '/', 'choosing one takes them home', String(chosen.status));
	const now = await asThem('/');
	check(now.status === 200, 'and this browser stays signed in', String(now.status));
	const other = await as(second)('/');
	check(
		to(other) === '/login',
		'the other browser that used the temporary one is signed out',
		`${other.status} ${to(other)}`
	);
	check(!(await signIn(email, handed)), 'the temporary one no longer signs in');
	check(!!(await signIn(email, own)), 'their own does');
	const chose = await asThem('/new-password');
	check(to(chose) === '/', 'and there is nothing left to choose', String(chose.status));
	const page = await (await asFull(`/team/${id}`)).text();
	check(
		page.includes('Active') && !page.includes('Yet to choose their own password'),
		'their page says Active, with nothing left to choose'
	);

	// ------------------------------------------------- changing theirs ----
	const elsewhere = await signIn(email, own);
	const changing = await asThem('/profile/password');
	check(
		changing.status === 200 && (await changing.text()).includes('Update password'),
		'the page to change it opens'
	);
	const since = 'a-password-changed-since';
	const notTheirs = await change(asThem, 'not-their-password', since);
	check(
		notTheirs.status === 400 && (await notTheirs.text()).includes('isn’t your current password'),
		'a current password that isn’t theirs is refused',
		String(notTheirs.status)
	);
	const tooShort = await change(asThem, own, 'too-short');
	check(
		tooShort.status === 400,
		'a new one shorter than twelve is refused',
		String(tooShort.status)
	);
	const apart = await change(asThem, own, since, 'a-password-changed-later');
	check(apart.status === 400, 'two that differ are refused', String(apart.status));

	const changed = await change(asThem, own, since);
	const renewed = sessionOf(changed);
	check(
		changed.status === 200 && (await changed.text()).includes('Password updated'),
		'changing it says so',
		String(changed.status)
	);
	check(!!renewed && renewed !== first, 'and gives this browser a new session');
	const before = await asThem('/');
	check(to(before) === '/login', 'so the session it was changed in is gone', `${before.status}`);
	asThem = as(renewed);
	const after = await asThem('/');
	check(after.status === 200, 'and this browser stays signed in', String(after.status));
	const away = await as(elsewhere)('/');
	check(to(away) === '/login', 'the other browser is signed out', `${away.status} ${to(away)}`);
	check(!(await signIn(email, own)), 'the old one no longer signs in');
	check(!!(await signIn(email, since)), 'the new one does');

	// ------------------------------------------------------- a reset ----
	const reset = await asFull(`/api/people/${id}/password`, { method: 'POST' });
	const replaced = reset.ok ? ((await reset.json()).password ?? '') : '';
	check(
		reset.status === 200 && FOUR_WORDS.test(replaced) && replaced !== handed,
		'a reset answers with another four words',
		`${reset.status}, ${replaced === handed ? 'the same as before' : shape(replaced)}`
	);
	const out = await asThem('/');
	check(to(out) === '/login', 'and signs them out everywhere', `${out.status} ${to(out)}`);
	check(!(await signIn(email, since)), 'their own password no longer signs in');
	const back = await signIn(email, replaced);
	const held = back ? await as(back)('/') : null;
	check(
		!!held && to(held) === '/new-password',
		'the new one does, and holds them until they choose',
		String(held?.status)
	);
	const resetPage = await (await asFull(`/team/${id}`)).text();
	check(
		resetPage.includes('Yet to choose their own password'),
		'their page says they have yet to choose'
	);

	const [{ id: mine }] = (
		await db.query('select id from "user" where email = $1', [fullEmail.toLowerCase()])
	).rows;
	const self = await asFull(`/api/people/${mine}/password`, { method: 'POST' });
	check(
		self.status === 400 && !!(await problemOf(self))?.errors?.password,
		'nobody resets their own',
		String(self.status)
	);
} finally {
	if (id) await db.query('delete from "user" where id = $1', [id]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
