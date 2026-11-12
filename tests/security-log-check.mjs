#!/usr/bin/env node
/**
 * Proves the security log keeps what it says it does (#lib/server/events), and
 * shows each person theirs and someone with Full everyone's: a sign-in, a
 * sign-in refused for a passkey reckon doesn't know, a screen and a request
 * refused to Field, Field's access changed by someone with Full and changed
 * back, link codes tried until the network is turned away, what Team shows of
 * each person, and a sign-out --
 * each a row, from where it came, and each said on Your profile and on Team. Field opens neither Team's log nor anyone's on it.
 *
 *   node tests/security-log-check.mjs <base-url> <full-email> <field-email>
 *
 * Signed in with the passkeys tests/passkeys.mjs gave them. Needs the database
 * the server uses, to read the rows as kept. Field's access ends as it began.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { signIn, signInWith } from './passkeys.mjs';
import { softPasskeys } from './soft-passkey.mjs';

const [, , base, fullEmail, fieldEmail] = process.argv;
if (!base || !fullEmail || !fieldEmail) {
	console.error('usage: node tests/security-log-check.mjs <base-url> <full-email> <field-email>');
	process.exit(2);
}

/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

let passed = 0;
/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what, detail = '') => {
	if (ok) passed++;
	else failures.push(detail ? `${what}: ${detail}` : what);
	console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` (${detail})`}`);
};

const as =
	(/** @type {string} */ cookie) =>
	(/** @type {string} */ path, /** @type {RequestInit} */ init = {}) =>
		fetch(base + path, {
			redirect: 'manual',
			...init,
			headers: { cookie, origin: base, ...PROXY, ...(init.headers ?? {}) }
		});

const db = new pg.Client(database());
await db.connect();
const idOf = async (/** @type {string} */ email) =>
	/** @type {string} */ (
		(await db.query('select id from "user" where email = $1', [email])).rows[0].id
	);
const full = await idOf(fullEmail);
const field = await idOf(fieldEmail);
const [{ since }] = (await db.query('select now() as since')).rows;
/** Rows of `name` since this check began, matching `where` (SQL over e). */
const rows = async (
	/** @type {string} */ name,
	where = 'true',
	/** @type {unknown[]} */ values = []
) =>
	(
		await db.query(
			`select e.user_id, e.by_id, host(e.client_address) as address, e.user_agent, e.detail
			   from security_event e where e.name = $1 and e.at >= $2 and (${where}) order by e.at`,
			[name, since, ...values]
		)
	).rows;

console.log('A sign-in, and one refused');
const fieldSession = await signIn(base, fieldEmail);
const signedIn = await rows('authn_login_success', 'e.user_id = $3', [field]);
check(
	signedIn.length === 1,
	'a sign-in is recorded, for whoever signed in',
	`${signedIn.length} rows`
);
check(
	signedIn[0]?.detail?.with === 'a passkey',
	'with the passkey as its factor (16.3.1)',
	JSON.stringify(signedIn[0]?.detail)
);
check(
	Boolean(signedIn[0]?.address) && Boolean(signedIn[0]?.user_agent),
	'from the address and browser it came from',
	JSON.stringify(signedIn[0])
);

const stranger = softPasskeys({ origin: base });
stranger.create({
	challenge: randomBytes(32).toString('base64url'),
	rp: { id: new URL(base).hostname },
	user: { id: randomBytes(16).toString('base64url') }
});
check(
	(await signInWith(base, stranger)) === null,
	'a passkey reckon does not know signs nobody in'
);
const refused = await rows('authn_login_fail', 'e.user_id is null');
check(
	refused.length === 1,
	'and is recorded as a refused sign-in, about nobody reckon knows',
	`${refused.length} rows`
);
check(
	refused[0]?.detail?.because === 'unknown passkey',
	'saying why',
	JSON.stringify(refused[0]?.detail)
);

console.log('Field refused what needs Full');
const asField = as(fieldSession.cookie);
const screen = await asField('/team');
check(
	screen.status === 303 && /\/refused/.test(screen.headers.get('location') ?? ''),
	'Team turns Field away',
	`${screen.status} ${screen.headers.get('location')}`
);
const request = await asField('/api/people', { method: 'GET' });
check(request.status === 403, 'and Team’s request refuses them', String(request.status));
const authz = await rows('authz_fail', 'e.user_id = $3', [field]);
check(
	authz.some((r) => r.detail?.route === '/team') &&
		authz.some((r) => r.detail?.route === '/api/people'),
	'each refusal is recorded, by its route (16.3.2)',
	JSON.stringify(authz.map((r) => r.detail))
);
for (const path of ['/team/security-log', `/team/${full}/security-log`]) {
	const r = await asField(path);
	check(
		r.status === 303 && /\/refused/.test(r.headers.get('location') ?? ''),
		`Field opens no security log on Team (${path.replace(full, ':id')})`,
		String(r.status)
	);
}

console.log('Field’s access changed, and changed back');
const fullSession = await signIn(base, fullEmail);
const asFull = as(fullSession.cookie);
const access = (/** @type {string} */ to) =>
	asFull(`/api/people/${field}`, {
		method: 'PATCH',
		body: JSON.stringify({ fields: { access: to } }),
		headers: { 'content-type': 'application/json' }
	});
check((await access('full')).ok, 'Full gives Field Full');
check((await access('full')).ok, 'and again, which changes nothing');
check((await access('field')).ok, 'and takes it back');
const changed = await rows('authz_change', 'e.user_id = $3', [field]);
check(
	changed.length === 2 &&
		changed[0].detail?.from === 'field' &&
		changed[0].detail?.to === 'full' &&
		changed[1].detail?.from === 'full' &&
		changed[1].detail?.to === 'field',
	'each change is recorded from and to, and the one that changed nothing is not',
	JSON.stringify(changed.map((r) => r.detail))
);
check(
	changed.every((r) => r.by_id === full),
	'by whoever made it',
	JSON.stringify(changed.map((r) => r.by_id))
);

console.log('What each sees');
const own = await (await asField('/profile/security-log')).text();
check(
	own.includes('Signed in') && own.includes('with a passkey'),
	'Field’s own log says they signed in, and how'
);
check(
	own.includes('Lack of access') && own.includes('/api/people'),
	'and that they were refused, and what'
);
check(
	own.includes('Access changed') && own.includes('Field to Full') && own.includes('Full to Field'),
	'and their access changed, from and to'
);
check(!own.includes('a passkey reckon doesn’t know'), 'but not a refusal about nobody they are');
const everyone = await (await asFull('/team/security-log')).text();
check(
	everyone.includes('Sign-in') && everyone.includes('a passkey reckon doesn’t know'),
	'Team’s log, for Full, has the stranger’s refused sign-in'
);
check(everyone.includes('Nobody reckon knows'), 'about nobody reckon knows');
const theirs = await (await asFull(`/team/${field}/security-log`)).text();
check(
	theirs.includes('Access changed') && theirs.includes('Lack of access'),
	'and Field’s own page on Team has theirs'
);
const older = await asFull('/team/security-log?before=not-a-cursor');
check(older.ok, 'a page of it asked for by nonsense starts from the newest', String(older.status));

console.log('Link codes tried too often');
// This machine's network, as the link page counts it (#lib/server/links).
const HERE = '127.0.0.1/32';
await db.query('delete from link_try where network = $1', [HERE]);
const look = async (/** @type {string} */ code) => {
	const r = await fetch(`${base}/link?/look`, {
		method: 'POST',
		body: new URLSearchParams({ code }),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-sveltekit-action': 'true',
			origin: base,
			...PROXY
		}
	});
	return /** @type {{ status?: number }} */ (await r.json()).status;
};
const misses = [];
for (let i = 0; i < 10; i++) misses.push(await look(randomBytes(32).toString('base64url')));
check(
	misses.every((st) => st === 404),
	'ten codes that are no link are each refused',
	misses.join(' ')
);
check(
	(await look(randomBytes(32).toString('base64url'))) === 429,
	'and the eleventh is turned away'
);
const deadLinks = await rows('authn_link_refused', 'e.user_id is null');
const turned = await rows('excess_rate_limit_exceeded', "e.detail->>'tried' = 'link codes'");
check(
	deadLinks.length === 10,
	'each code that was no link is recorded',
	`${deadLinks.length} rows`
);
check(turned.length === 1, 'and being turned away is too (16.3.3)', `${turned.length} rows`);
await db.query('delete from link_try where network = $1', [HERE]);

console.log('What Team shows of each person');
const fieldName = /** @type {string} */ (
	(await db.query('select name from "user" where id = $1', [field])).rows[0].name
);
const team = await (await asFull('/team')).text();
const fieldRow = team.slice(team.indexOf(fieldName));
check(
	/Signed in [^<]*·\s*1(\s|&nbsp;)passkey[^<]*·\s*\d+(\s|&nbsp;)sessions? open/.test(fieldRow),
	'when each last signed in, their passkeys and where each is kept, and the sessions they have open',
	fieldRow.slice(0, 300).replace(/\s+/g, ' ')
);

console.log('Signing out');
const out = await asField('/logout', {
	method: 'POST',
	body: '',
	headers: { 'content-type': 'application/x-www-form-urlencoded' }
});
check(out.status === 303, 'Field signs out', String(out.status));
const loggedOut = await rows('session_logout', 'e.user_id = $3', [field]);
check(loggedOut.length === 1, 'and it is recorded', `${loggedOut.length} rows`);

await db.end();
if (failures.length) {
	console.log(`\n  ${passed} passed, ${failures.length} failed`);
	for (const f of failures) console.log(`    ${f}`);
	process.exit(1);
}
console.log(`\n${passed} checks of the security log passed.`);
