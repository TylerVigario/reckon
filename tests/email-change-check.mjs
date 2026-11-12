#!/usr/bin/env node
/**
 * Proves a new address for someone who has signed in waits until it is proven
 * theirs (api/people/[id] changeEmail, #lib/server/links): they keep the one
 * they have until they use a link sent to the new one; the old one is told,
 * with the new address and no link; Team and their profile say it waits; a
 * newer change, a cancelled one or a link sent again ends the link before; an
 * address someone else has taken since is not made theirs; and using the link
 * makes the new address the one they sign in with, confirmed, once. Someone
 * deactivated changes at once, and nobody is emailed.
 *
 *   node tests/email-change-check.mjs <base-url> <full-email> [relay-read-back-url]
 *
 * The server sends to the relay stand-in (tests/smtp-stand-in.mjs), read back
 * at http://127.0.0.1:2526 unless said, with SITE_URL the base url. Over HTTP,
 * the way a browser does it. Needs the database the server uses. The people
 * it adds are left inactive, as anyone in the security log is, never deleted;
 * the email it made is gone.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import pg from 'pg';
import { arrives, inbox, linkAction, linkIn } from './relay.mjs';
import { makePasskey, signIn, signInWith } from './passkeys.mjs';

const [, , base, fullEmail, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail) {
	console.error(
		'usage: node tests/email-change-check.mjs <base-url> <full-email> [relay-read-back-url]'
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

/** One of the link page's actions, as its page posts it. */
const act = (
	/** @type {'look' | 'begin' | 'confirm' | 'change'} */ name,
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

const asFull = as((await signIn(base, fullEmail)).cookie);
const [{ name: fullName }] = (
	await db.query('select name from "user" where email = $1', [fullEmail.toLowerCase()])
).rows;
const tag = crypto.randomUUID().slice(0, 8);
const first = `rowan-${tag}@kestrel.example`;
const second = `rowan-new-${tag}@fieldmail.example`;
const third = `rowan-third-${tag}@fieldmail.example`;
const taken = `rowan-taken-${tag}@fieldmail.example`;
const fourth = `rowan-fourth-${tag}@fieldmail.example`;
const fifth = `rowan-fifth-${tag}@fieldmail.example`;
const other = `ellis-${tag}@kestrel.example`;
/** @type {string[]} */
const made = [];
const addresses = [first, second, third, taken, fourth, fifth, other];
const emailOf = async (/** @type {string} */ id) =>
	(await db.query('select email, email_verified from "user" where id = $1', [id])).rows[0];
const changeTo = (/** @type {string} */ id, /** @type {string} */ address) =>
	asFull(`/api/people/${id}`, send('PATCH', { fields: { email: address } }));

try {
	// ------------------------------------------- someone who has joined ----
	const added = await asFull(
		'/api/people',
		send('POST', { fields: { name: 'Rowan Pike', email: first, role_id: '', access: 'field' } })
	);
	const id = added.status === 201 ? (await added.json()).id : null;
	if (!id) throw new Error(`nobody was added (${added.status}), so nothing after it can be asked`);
	made.push(id);
	const invite = await codeFor(first, ['make your passkey']);
	const joined = await makePasskey(base, invite);
	if (!joined) throw new Error('they could not make a passkey');
	const theirCookie = joined.cookie;
	check(!!theirCookie, 'someone who has made a passkey is signed in');

	// ----------------------------------------------------- asked for ----
	const asked = await changeTo(id, second);
	const answer = asked.status === 202 ? await asked.json() : null;
	check(
		asked.status === 202 && answer?.waiting?.to === second && !!answer?.waiting?.until,
		'a new address for them waits, said with where its link went and until when',
		`${asked.status} ${JSON.stringify(answer)}`
	);
	check((await emailOf(id))?.email === first, 'and they keep the address they have');
	const toNew = await arrives(relay, second, ['confirm your new email', `${fullName} is changing`]);
	const secondCode = linkIn(toNew)?.code ?? '';
	seen.add(secondCode);
	check(!!secondCode, 'the new address is sent a link, naming who asked');
	check(!!toNew && !toNew.text.includes(first), 'and is not told the address they have now');
	const toOld = await arrives(relay, first, ['your sign-in email is changing', second, fullName]);
	check(!!toOld, 'the address they have is told, with the new one and who asked');
	check(!!toOld && !linkIn(toOld), 'and carries no link');
	check(
		!!(await signInWith(base, joined.keys)),
		'their passkey still signs them in while it waits'
	);

	const theirPage = await (await asFull(`/team/${id}`)).text();
	check(
		theirPage.includes('Pending') && theirPage.includes(second),
		'their page on Team says the change is pending, and to what'
	);
	const profile = await (await as(theirCookie)('/profile')).text();
	check(profile.includes(`Changing to ${second}`), 'their own profile says it waits, and where');

	const looked = await act('look', { code: secondCode });
	check(
		looked.type === 'success' && looked.text.includes('change') && looked.text.includes(second),
		'its code says it is a change, and to what'
	);
	const begun = await act('begin', { code: secondCode });
	check(begun.type === 'failure', 'a change’s link does not make a passkey');
	const confirmed = await act('confirm', { code: secondCode });
	check(confirmed.type === 'failure', 'nor only confirm an address');

	// ------------------------------------------ newer, again, cancelled ----
	await changeTo(id, third);
	const thirdCode = await codeFor(third, ['confirm your new email']);
	check(
		!!thirdCode && (await works(thirdCode)) && !(await works(secondCode)),
		'a newer change ends the one waiting'
	);
	const again = await asFull(`/api/people/${id}/email-change`, { method: 'POST' });
	const againCode = await codeFor(third, ['confirm your new email']);
	check(
		again.status === 200 && !!againCode && !(await works(thirdCode)) && (await works(againCode)),
		'sending it again sends a new link, and the one before stops',
		String(again.status)
	);
	const told = (
		await db.query(
			`select count(*)::int as n from email_message where user_id = $1 and kind = 'email_changing'`,
			[id]
		)
	).rows[0].n;
	check(told === 2, 'and does not tell the old address again', `${told} told`);
	const cancelled = await asFull(`/api/people/${id}/email-change`, { method: 'DELETE' });
	check(
		cancelled.status === 204 && !(await works(againCode)),
		'cancelling it stops its link',
		String(cancelled.status)
	);
	const twice = await asFull(`/api/people/${id}/email-change`, { method: 'DELETE' });
	check(twice.status === 404, 'and there is nothing left to cancel', String(twice.status));
	check((await emailOf(id))?.email === first, 'they keep the address they have');

	// ----------------------------------------------------- taken since ----
	await changeTo(id, taken);
	const takenCode = await codeFor(taken, ['confirm your new email']);
	const ellis = await asFull(
		'/api/people',
		send('POST', { fields: { name: 'Ellis Gray', email: other, role_id: '', access: 'field' } })
	);
	const ellisId = ellis.status === 201 ? (await ellis.json()).id : null;
	if (ellisId) made.push(ellisId);
	const moved = ellisId ? await changeTo(ellisId, taken) : null;
	check(
		moved?.status === 200 && (await emailOf(ellisId))?.email === taken,
		'someone yet to accept their invitation changes address at once',
		String(moved?.status)
	);
	const refused = await act('change', { code: takenCode });
	check(
		refused.type === 'failure' && refused.status === 409 && refused.text.includes('taken'),
		'an address someone else has taken since is not made theirs',
		`${refused.type} ${refused.status}`
	);
	check((await emailOf(id))?.email === first, 'and they keep the one they have');
	const askTaken = await changeTo(id, taken);
	check(
		askTaken.status === 400,
		'nor is a change asked for to an address someone signs in with',
		String(askTaken.status)
	);

	// ------------------------------------------------------------ used ----
	await changeTo(id, fourth);
	const fourthCode = await codeFor(fourth, ['confirm your new email']);
	const used = await act('change', { code: fourthCode });
	const now = await emailOf(id);
	check(
		used.type === 'success' && now?.email === fourth && now?.email_verified === true,
		'using the link makes the new address theirs, confirmed',
		`${used.type} ${JSON.stringify(now)}`
	);
	check(
		!!(await signInWith(base, joined.keys)),
		'their passkey signs them in, whatever the address'
	);
	check((await act('change', { code: fourthCode })).type === 'failure', 'the link works once');
	const stillIn = await as(theirCookie)('/profile');
	check(
		stillIn.status === 200,
		'and where they were signed in, they still are',
		String(stillIn.status)
	);

	// ----------------------------------------------------- deactivated ----
	await asFull(
		`/api/people/${id}`,
		send('PATCH', { fields: { active: 'false' }, reason: 'Checking a change to someone inactive' })
	);
	const [{ since }] = (await db.query('select now() as since')).rows;
	const gone = await changeTo(id, fifth);
	const after = (await emailOf(id)) ?? {};
	check(
		gone.status === 200 && after.email === fifth && after.email_verified === false,
		'someone deactivated changes at once, unconfirmed',
		`${gone.status} ${JSON.stringify(after)}`
	);
	const written = (
		await db.query(
			'select count(*)::int as n from email_message where user_id = $1 and created_at >= $2',
			[id, since]
		)
	).rows[0].n;
	check(written === 0, 'and nobody is emailed', `${written} written`);
} catch (e) {
	const why = e instanceof Error ? e.message : String(e);
	failures.push(why);
	console.log(`  ✗ ${why}`);
} finally {
	// Left inactive, as anyone in the security log is: never deleted.
	for (const who of made) await db.query('update "user" set active = false where id = $1', [who]);
	await db.query('delete from email_message where to_address = any($1)', [addresses]);
	await db.query('delete from link_try where network = $1', [HERE]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
