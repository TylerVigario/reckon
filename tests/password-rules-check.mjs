#!/usr/bin/env node
/**
 * Proves the password rules (#lib/server/password-rules) and a breach found as
 * someone signs in (#lib/server/breach). A password chosen with a link, or on
 * Your profile, is refused if it is shorter than fifteen, one of the most
 * common, seen by Pwned Passwords, or made of the person's or the business's
 * names, each saying why, and a refusal leaves the link working. A right
 * password Pwned Passwords has seen since it was chosen opens nothing: it
 * stops, every session they had ends, the try is recorded as breached, and a
 * confirmed address is emailed the hour's link to choose another, which says
 * the old one has stopped; one not confirmed is told so, with no link. Where
 * Pwned Passwords cannot say, the sign-in goes ahead.
 *
 *   node tests/password-rules-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]
 *
 * The server asks the Pwned Passwords stand-in (tests/pwned-stand-in.mjs,
 * PWNED_PASSWORDS_URL) and sends to the relay stand-in (tests/smtp-stand-in.mjs),
 * read back at http://127.0.0.1:2526 unless said, with SITE_URL the base url.
 * Over HTTP, the way a browser does it. Needs the database the server uses: it
 * leaves nothing it made.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { hash } from '@node-rs/argon2';
import { parse } from 'devalue';
import pg from 'pg';
import { BREACHED, CANNOT_SAY } from './pwned-stand-in.mjs';
import { arrives, linkAction, linkIn } from './relay.mjs';

const [, , base, fullEmail, fullPassword, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail || !fullPassword) {
	console.error(
		'usage: node tests/password-rules-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]'
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

/** What a page says: its <main>, without the markup. */
const said = (/** @type {string} */ html) =>
	(/<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** A sign-in, as the page's form posts it: what it answered, and the session it set, if any. */
const signIn = async (/** @type {string} */ email, /** @type {string} */ password) => {
	const r = await fetch(`${base}/login`, {
		method: 'POST',
		body: new URLSearchParams({ email, password, next: '/' }),
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
			origin: base,
			...PROXY
		}
	});
	const cookie = r.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		// A cookie set empty is one taken away.
		.filter((c) => /session_token=[^;]/.test(c))
		.join('; ');
	return { status: r.status, cookie, said: r.status === 303 ? '' : said(await r.text()) };
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
const send = (/** @type {string} */ method, /** @type {unknown} */ body) => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

/** One of the link page's actions, as its page posts it, with what it answered. */
const act = async (
	/** @type {'look' | 'choose' | 'confirm' | 'change'} */ name,
	/** @type {Record<string, string>} */ fields
) => {
	const r = await linkAction(base, name, fields, PROXY);
	const { data } = JSON.parse(r.text);
	return { ...r, data: data ? parse(data) : null };
};

/** A password chosen on Your profile, as its form posts it: what it said, if refused. */
const change = async (
	/** @type {Ask} */ asThem,
	/** @type {string} */ current,
	/** @type {string} */ password
) => {
	const r = await asThem('/profile/password', {
		method: 'POST',
		body: new URLSearchParams({ current, password, confirm: password }),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-sveltekit-action': 'true'
		}
	});
	const { type, data } = JSON.parse(await r.text());
	return { type, message: data ? String(parse(data).message ?? '') : '' };
};

const db = new pg.Client(database());
await db.connect();
/** The password someone signs in with, set as if they had chosen it long ago. */
const setPassword = async (/** @type {string} */ id, /** @type {string} */ password) => {
	const stored = await hash(password);
	const { rowCount } = await db.query(
		`update account set password = $2 where user_id = $1 and provider_id = 'credential'`,
		[id, stored]
	);
	if (!rowCount)
		await db.query(
			`insert into account (user_id, account_id, provider_id, password)
			 values ($1::uuid, $1::text, 'credential', $2)`,
			[id, stored]
		);
	await db.query(
		'update "user" set password_set_at = now(), password_stopped_at = null where id = $1',
		[id]
	);
};
/** How many emails of these kinds went to an address. */
const told = async (/** @type {string} */ to, /** @type {string[]} */ kinds) =>
	(
		await db.query(
			'select count(*)::int as n from email_message where to_address = $1 and kind = any($2)',
			[to, kinds]
		)
	).rows[0].n;

const full = await signIn(fullEmail, fullPassword);
if (!full.cookie) {
	console.error(`  could not sign in as ${fullEmail}`);
	process.exit(1);
}
const asFull = as(full.cookie);
const tag = crypto.randomUUID().slice(0, 8);
const rowan = `rowan-${tag}@kestrel.example`;
const jun = `jun-${tag}@kestrel.example`;
/** @type {string[]} */
const made = [];
const add = async (/** @type {string} */ name, /** @type {string} */ email) => {
	const r = await asFull(
		'/api/people',
		send('POST', { fields: { name, email, role_id: '', access: 'field' } })
	);
	const id = r.status === 201 ? (await r.json()).id : null;
	if (!id) throw new Error(`${name} was not added (${r.status})`);
	made.push(id);
	return id;
};
const GOOD = 'tundra-ladle-orbit-velvet';
const LATER = 'quiet-harbor-maple-lantern';

try {
	// ------------------------------------------------ chosen with a link ----
	const rowanId = await add('Rowan Vale', rowan);
	const code = linkIn(await arrives(relay, rowan, ['choose your password']))?.code ?? '';
	const refused = async (/** @type {string} */ password) =>
		act('choose', { code, password, confirm: password });
	const short = await refused('fourteen-chars');
	check(
		short.status === 400 && String(short.data?.message).includes('at least 15'),
		'a password shorter than fifteen is refused, saying so',
		String(short.data?.message)
	);
	const common = await refused('1q2w3e4r5t6y7u8i');
	check(
		common.status === 400 && String(common.data?.message).includes('most common'),
		'one of the most common is refused, saying so'
	);
	const seen = await refused(BREACHED[0]);
	check(
		seen.status === 400 && String(seen.data?.message).includes('data breach'),
		'one Pwned Passwords has seen is refused, saying so'
	);
	const theirs = await refused('Rowan-Vale-Kestrel-2026');
	check(
		theirs.status === 400 && String(theirs.data?.message).includes('your name'),
		'one made of their names and the business’s is refused, saying so'
	);
	check(
		(await act('look', { code })).type === 'success',
		'and a refused password leaves the link working'
	);
	check(
		(await act('choose', { code, password: GOOD, confirm: GOOD })).type === 'success',
		'one that keeps every rule is chosen'
	);

	// ------------------------------------------- chosen on Your profile ----
	const rowanIn = await signIn(rowan, GOOD);
	const onProfile = await change(as(rowanIn.cookie), GOOD, BREACHED[1]);
	check(
		onProfile.type === 'failure' && onProfile.message.includes('data breach'),
		'on Your profile, one Pwned Passwords has seen is refused too',
		onProfile.message
	);
	const notSaid = await change(as(rowanIn.cookie), GOOD, CANNOT_SAY);
	check(
		notSaid.type === 'redirect' || notSaid.type === 'success',
		'where Pwned Passwords cannot say, the other rules decide',
		notSaid.type
	);
	const stillIn = await signIn(rowan, CANNOT_SAY);
	check(
		stillIn.status === 303 && !!stillIn.cookie,
		'and a sign-in it cannot say about goes ahead',
		String(stillIn.status)
	);

	// --------------------------------- found in a breach, as they sign in ----
	// Rowan's password was fine when chosen; Pwned Passwords has seen it since.
	await setPassword(rowanId, BREACHED[0]);
	const before = await signIn(rowan, BREACHED[0]);
	check(before.status === 403, 'signing in with it is refused', String(before.status));
	check(!before.cookie, 'and opens no session');
	check(
		before.said.includes('appeared in a data breach') &&
			before.said.includes(`We’ve emailed ${rowan} a link`),
		'the page says why, and that a link is on its way',
		before.said
	);
	const ended = await as(stillIn.cookie)('/profile');
	check(ended.status === 303, 'every session they had is ended', String(ended.status));
	const [stopped] = (
		await db.query(
			`select u.password_stopped_at is not null as stopped,
			        (select outcome from sign_in_try t where t.user_id = u.id
			          order by t.created_at desc limit 1) as outcome
			   from "user" u where u.id = $1`,
			[rowanId]
		)
	).rows;
	check(!!stopped?.stopped, 'the password stops');
	check(stopped?.outcome === 'breached', 'and the try is recorded as breached', stopped?.outcome);
	const mail = await arrives(relay, rowan, ['choose a new password', 'data breach']);
	const recover = linkIn(mail)?.code ?? '';
	check(!!recover, 'they are emailed a link to choose another, saying why');
	const again = await signIn(rowan, BREACHED[0]);
	await new Promise((r) => setTimeout(r, 1000));
	check(
		again.status === 400 && again.said.includes('Wrong email or password'),
		'signing in with it again is answered as a wrong password is',
		again.said
	);
	check(
		(await told(rowan, ['password_breached'])) === 1,
		'and sends nothing more',
		`${await told(rowan, ['password_breached'])} sent`
	);
	const looked = await act('look', { code: recover });
	check(
		looked.data?.purpose === 'recover' && looked.data?.stopped === true,
		'the link says the old password has stopped'
	);
	check(
		(await act('choose', { code: recover, password: LATER, confirm: LATER })).type === 'success',
		'with it, a new password is chosen'
	);
	check((await signIn(rowan, LATER)).status === 303, 'and signs in');

	// ------------------------------------- to an address not confirmed ----
	// Jun has not used their invitation, so their address is not confirmed.
	const junId = await add('Jun Hale', jun);
	await setPassword(junId, BREACHED[1]);
	const unconfirmed = await signIn(jun, BREACHED[1]);
	check(
		unconfirmed.status === 403 &&
			!unconfirmed.cookie &&
			unconfirmed.said.includes('hasn’t been confirmed') &&
			/Contact .+ to have one sent/.test(unconfirmed.said),
		'an address not confirmed is refused alike, and told whom to contact for a link',
		unconfirmed.said
	);
	const notice = await arrives(relay, jun, ['stopped working', 'data breach']);
	check(!!notice && !linkIn(notice), 'and is told so by email, with no link');
} catch (e) {
	const why = e instanceof Error ? e.message : String(e);
	failures.push(why);
	console.log(`  ✗ ${why}`);
} finally {
	await db.query('delete from sign_in_try where user_id = any($1)', [made]);
	for (const who of made) await db.query('delete from "user" where id = $1', [who]);
	await db.query('delete from email_message where to_address = any($1)', [[rowan, jun]]);
	await db.query(`delete from link_try where network = '127.0.0.1/32'`);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
