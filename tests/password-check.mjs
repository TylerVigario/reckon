#!/usr/bin/env node
/**
 * Proves a person chooses their own password, by a link emailed to them, and
 * that it is theirs to change (#lib/server/links): someone added on Team is
 * invited by email, and whoever added them sees no password and no link; the
 * link opens a page, outside the app, that takes a password once and signs
 * nobody in; a reset on Team stops the old password, signs them out
 * everywhere and emails a link to choose a new one; an invitation lapses after
 * 24 hours and is sent again, and one waiting goes to a corrected address
 * instead; anyone confirms their address from Your profile; and a code that is
 * not one to use is answered alike, and counted until the network waits.
 *
 * Someone handed a temporary password before invitations were emailed still
 * reaches nothing but /new-password until they choose their own. A password
 * is changed on Your profile with the current one, which renews that browser's
 * session and signs out every other.
 *
 *   node tests/password-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]
 *
 * The server sends to the relay stand-in (tests/smtp-stand-in.mjs), read back
 * at http://127.0.0.1:2526 unless said, with SITE_URL the base url. Over HTTP,
 * the way a browser does it. Needs the database the server uses: it leaves
 * nothing it made.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { arrives, inbox, linkAction, linkIn } from './relay.mjs';

const [, , base, fullEmail, fullPassword, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail || !fullPassword) {
	console.error(
		'usage: node tests/password-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]'
	);
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
const change = (
	/** @type {Ask} */ ask,
	/** @type {string} */ current,
	/** @type {string} */ password,
	confirm = password
) => post(ask, '/profile/password', { current, password, confirm });

/** One of the link page's actions, as its page posts it. */
const act = (
	/** @type {'look' | 'choose' | 'confirm'} */ name,
	/** @type {Record<string, string>} */ fields
) => linkAction(base, name, fields, PROXY);
/** Every code an email has carried so far, so each one asked for is a new one. */
const seen = new Set();
/**
 * The code in the newest email to `email` saying all of `says` that carries
 * one not seen before, waited for: '' if none comes.
 */
async function codeFor(/** @type {string} */ email, /** @type {string[]} */ says) {
	for (let i = 0; i < 60; i++) {
		const fresh = (await inbox(relay))
			.filter((m) => m.to.includes(email) && says.every((s) => m.text.includes(s)))
			.map((m) => linkIn(m)?.code)
			.filter((c) => !!c && !seen.has(c));
		const code = fresh.at(-1);
		if (code) {
			seen.add(code);
			return code;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	return '';
}
const works = async (/** @type {string} */ code) =>
	(await act('look', { code })).type === 'success';

const db = new pg.Client(database());
await db.connect();
/** Whose network the server sees these checks come from: this machine. */
const HERE = '127.0.0.1/32';

const fullCookie = await signIn(fullEmail, fullPassword);
if (!fullCookie) {
	console.error(`  could not sign in as ${fullEmail}`);
	process.exit(1);
}
const asFull = as(fullCookie);
const [{ id: mine, name: fullName }] = (
	await db.query('select id, name from "user" where email = $1', [fullEmail.toLowerCase()])
).rows;
const tag = crypto.randomUUID().slice(0, 8);
const email = `invited-${tag}@kestrel.example`;
const jun = `jun-${tag}@kestrel.example`;
const corrected = `corrected-${tag}@kestrel.example`;
/** @type {string[]} */
const made = [];
const addresses = [email, jun, corrected];

try {
	// ---------------------------------------------------------- invited ----
	const added = await asFull(
		'/api/people',
		send('POST', { fields: { name: 'Quinn Harper', email, role_id: '', access: 'field' } })
	);
	const answer = added.status === 201 ? await added.json() : null;
	const id = answer?.id ?? null;
	if (id) made.push(id);
	check(
		added.status === 201 && !!id && answer.sent_to === email && !('password' in answer),
		'adding a person answers with where their invitation went, and no password',
		`${added.status} ${JSON.stringify(answer && Object.keys(answer))}`
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

	const invited = await arrives(relay, email, ['choose your password', `${fullName} added you`]);
	const link = linkIn(invited);
	check(!!link, 'they are emailed an invitation, naming who added them, with a link');
	check(link?.site === new URL(base).origin, 'the link begins with SITE_URL', String(link?.site));
	check(!!invited?.text.includes('It works once, until'), 'and says it works once, and until when');
	const code = link?.code ?? '';
	seen.add(code);
	const kept = (
		await db.query(`select row_to_json(l)::text as row from email_link l where user_id = $1`, [id])
	).rows;
	check(
		kept.length === 1 && !kept[0].row.includes(code),
		'only a hash of its code is kept',
		`${kept.length} row(s)`
	);
	const [mail] = (
		await db.query(
			`select send_by <= now() + interval '24 hours' as soon from email_message
			  where user_id = $1 and kind = 'invitation'`,
			[id]
		)
	).rows;
	check(!!mail?.soon, 'and the email is not sent once its link has stopped working');
	const team = await (await asFull('/team')).text();
	check(/Quinn Harper[\s\S]*?Invited/.test(team), 'Team says they are Invited');
	const theirPage = await (await asFull(`/team/${id}`)).text();
	check(theirPage.includes('Invitation sent at'), 'their page says when it went, and until when');

	// ------------------------------------------------------ the link ----
	const page = await fetch(`${base}/link`, { headers: PROXY });
	check(page.status === 200, 'the link opens without signing in', String(page.status));
	check(
		page.headers.get('referrer-policy') === 'no-referrer' &&
			(page.headers.get('cache-control') ?? '').includes('no-store'),
		'with no referrer sent from it, and nothing kept of it',
		`${page.headers.get('referrer-policy')} ${page.headers.get('cache-control')}`
	);
	const looked = await act('look', { code });
	check(
		looked.type === 'success' && looked.text.includes('invite') && looked.text.includes(email),
		'its code says what it is for, and whose'
	);
	const unknown = await act('look', { code: code.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) });
	const nonsense = await act('look', { code: 'not-a-code' });
	check(
		unknown.status === 404 && nonsense.status === 404 && unknown.text === nonsense.text,
		'a code that is not one is answered alike, whatever it is',
		`${unknown.status} ${nonsense.status}`
	);
	const short = await act('choose', { code, password: 'too-short', confirm: 'too-short' });
	check(short.status === 400, 'a password shorter than twelve is refused', String(short.status));
	const differ = await act('choose', {
		code,
		password: 'a-password-of-mine',
		confirm: 'a-password-of-yours'
	});
	check(differ.status === 400, 'two that differ are refused', String(differ.status));
	check(await works(code), 'and a refused password leaves the link working');

	const own = 'a-password-of-their-own';
	const chosen = await act('choose', { code, password: own, confirm: own });
	check(chosen.type === 'success', 'choosing one with it saves it', String(chosen.status));
	check(!chosen.setsSession, 'and signs nobody in');
	const twice = await act('choose', {
		code,
		password: 'another-one-of-theirs',
		confirm: 'another-one-of-theirs'
	});
	check(twice.status === 404, 'the link works once', String(twice.status));
	check(!(await works(code)), 'and is no longer one to use');
	const first = await signIn(email, own);
	check(!!first, 'they sign in with the one they chose');
	const [proven] = (await db.query('select email_verified from "user" where id = $1', [id])).rows;
	check(proven?.email_verified === true, 'and using the link proved the address theirs');
	check(
		!!(await arrives(relay, email, [
			'your password was changed',
			'with a link reckon emailed you'
		])),
		'they are told by email that it was set'
	);
	const nowPage = await (await asFull(`/team/${id}`)).text();
	check(
		nowPage.includes('Active') && nowPage.includes('Confirmed'),
		'their page says Active, and their email Confirmed'
	);

	// ------------------------------------------------- changing theirs ----
	let asThem = as(first);
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
	const changed = await change(asThem, own, since);
	const renewed = sessionOf(changed);
	check(
		changed.status === 200 && (await changed.text()).includes('Password updated'),
		'changing it says so',
		String(changed.status)
	);
	check(!!renewed && renewed !== first, 'and gives this browser a new session');
	asThem = as(renewed);
	const away = await as(elsewhere)('/');
	check(to(away) === '/login', 'the other browser is signed out', `${away.status} ${to(away)}`);
	check(!(await signIn(email, own)), 'the old one no longer signs in');
	check(!!(await signIn(email, since)), 'the new one does');

	// ------------------------------------------------------- a reset ----
	const reset = await asFull(`/api/people/${id}/password`, { method: 'POST' });
	const resetAnswer = reset.ok ? await reset.json() : null;
	check(
		reset.status === 200 && resetAnswer?.sent_to === email && !('password' in resetAnswer),
		'a reset answers with where the link went, and no password',
		String(reset.status)
	);
	const out = await asThem('/');
	check(to(out) === '/login', 'and signs them out everywhere', `${out.status} ${to(out)}`);
	check(!(await signIn(email, since)), 'their password stops working');
	const resetCode = await codeFor(email, [
		'your password was reset',
		`${fullName} reset the password`
	]);
	check(!!resetCode, 'they are emailed a link to choose a new one, naming who reset it');
	const resetPage = await (await asFull(`/team/${id}`)).text();
	check(resetPage.includes('Reset link sent at'), 'their page says the link went, and until when');
	const looksReset = await act('look', { code: resetCode });
	check(
		looksReset.type === 'success' && looksReset.text.includes('reset'),
		'the link says it is a reset'
	);
	const fresh = 'a-password-after-the-reset';
	const reChosen = await act('choose', { code: resetCode, password: fresh, confirm: fresh });
	check(
		reChosen.type === 'success' && !!(await signIn(email, fresh)),
		'choosing one with it works, and signs in',
		String(reChosen.status)
	);
	const self = await asFull(`/api/people/${mine}/password`, { method: 'POST' });
	check(
		self.status === 400 && !!(await problemOf(self))?.errors?.password,
		'nobody resets their own on Team',
		String(self.status)
	);

	// A password set some other way ends a link still waiting.
	await asFull(`/api/people/${id}/password`, { method: 'POST' });
	const waiting = await codeFor(email, ['your password was reset']);
	const shell = 'set-at-the-command-line';
	const ran = spawnSync('node', ['scripts/user.mjs', 'password', email], {
		input: `${shell}\n${shell}\n`,
		encoding: 'utf8'
	});
	check(
		ran.status === 0 && !!waiting && !(await works(waiting)),
		'a password set at the command line ends a link that was waiting',
		ran.stderr.trim()
	);

	// ------------------------------------------- lapsed, and sent again ----
	const second = await asFull(
		'/api/people',
		send('POST', { fields: { name: 'Jun Hale', email: jun, role_id: '', access: 'field' } })
	);
	const secondId = second.status === 201 ? (await second.json()).id : null;
	if (!secondId) throw new Error(`a second person was not added (${second.status})`);
	made.push(secondId);
	const lapsing = await codeFor(jun, ['choose your password']);
	await db.query(
		`update email_link set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
		  where user_id = $1`,
		[secondId]
	);
	check(!(await works(lapsing)), 'an invitation more than 24 hours old no longer works');
	const lapsedTeam = await (await asFull('/team')).text();
	check(/Jun Hale[\s\S]*?Invitation expired/.test(lapsedTeam), 'and Team says it expired');
	const resetInvited = await asFull(`/api/people/${secondId}/password`, { method: 'POST' });
	check(
		resetInvited.status === 400 && !!(await problemOf(resetInvited))?.errors?.password,
		'someone yet to choose a password is not reset, but invited again',
		String(resetInvited.status)
	);
	const resent = await asFull(`/api/people/${secondId}/invitation`, { method: 'POST' });
	check(
		resent.status === 200,
		'sending the invitation again is done on Team',
		String(resent.status)
	);
	const second1 = await codeFor(jun, ['choose your password']);
	check(!!second1 && second1 !== lapsing && (await works(second1)), 'with a new link that works');

	const moved = await asFull(
		`/api/people/${secondId}`,
		send('PATCH', { fields: { email: corrected } })
	);
	const second2 = await codeFor(corrected, ['choose your password']);
	check(
		moved.ok && !!second2 && (await works(second2)) && !(await works(second1)),
		'correcting the address of someone invited sends it there, and the old link stops',
		String(moved.status)
	);
	await asFull(`/api/people/${secondId}`, send('PATCH', { fields: { active: 'false' } }));
	check(!(await works(second2)), 'and deactivating them stops it too');

	// ------------------------------------------ confirmed from Profile ----
	await db.query('update "user" set email_verified = false where id = $1', [id]);
	const asTheirs = as(await signIn(email, shell));
	const profile = await (await asTheirs('/profile')).text();
	check(profile.includes('Not confirmed yet'), 'Your profile says an address is not confirmed');
	const asked = await post(asTheirs, '/profile?/confirm', {});
	check(
		asked.status === 200 && (await asked.text()).includes('on its way'),
		'asking to confirm it says a link is on its way',
		String(asked.status)
	);
	const confirmCode = await codeFor(email, ['confirm your email']);
	check(!!confirmCode, 'and emails one there');
	const soon = await post(asTheirs, '/profile?/confirm', {});
	check(soon.status === 429, 'another is not sent a moment later', String(soon.status));
	const confirmed = await act('confirm', { code: confirmCode });
	const [nowProven] = (await db.query('select email_verified from "user" where id = $1', [id]))
		.rows;
	check(
		confirmed.type === 'success' && nowProven?.email_verified === true,
		'using it confirms the address',
		String(confirmed.status)
	);
	check(
		(await act('choose', { code: confirmCode, password: fresh, confirm: fresh })).status === 404,
		'and a confirmation sets no password'
	);

	// --------------------------- a password handed over, before all this ----
	await db.query('update "user" set temporary_password = true where id = $1', [id]);
	const held = as(await signIn(email, shell));
	const home = await held('/');
	check(
		to(home) === '/new-password',
		'someone handed a temporary password is sent to choose one',
		`${home.status}`
	);
	const api = await held('/api/time');
	check(
		api.status === 403 && (await problemOf(api))?.type === '/problems/choose-password',
		'and an endpoint is refused, saying why',
		String(api.status)
	);
	const theirOwn = 'chosen-after-a-handover';
	const choseOwn = await post(held, '/new-password', { password: theirOwn, confirm: theirOwn });
	check(to(choseOwn) === '/', 'choosing their own lets them in', String(choseOwn.status));

	// ------------------------------------------------- too many misses ----
	await db.query('delete from link_try where network = $1', [HERE]);
	await asFull(`/api/people/${id}/password`, { method: 'POST' });
	const good = await codeFor(email, ['your password was reset']);
	for (let i = 0; i < 10; i++) await act('look', { code: `${'x'.repeat(42)}${i}` });
	const turned = await act('look', { code: good });
	check(
		!!good && turned.status === 429,
		'ten codes that are not one, from one network, and it waits before the next',
		String(turned.status)
	);
} catch (e) {
	const why = e instanceof Error ? e.message : String(e);
	failures.push(why);
	console.log(`  ✗ ${why}`);
} finally {
	for (const who of made) await db.query('delete from "user" where id = $1', [who]);
	await db.query('delete from email_message where to_address = any($1)', [addresses]);
	await db.query('delete from link_try where network = $1', [HERE]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
