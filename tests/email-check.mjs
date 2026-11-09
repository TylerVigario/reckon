#!/usr/bin/env node
/**
 * Proves reckon sends email (#lib/server/email): a person is told by email
 * whenever their password is changed -- chosen after a handover, changed on
 * Your profile, set at the command line, reset on Team -- and the email goes
 * through the relay as the business, marked as a machine's. A relay that puts a
 * message off has it tried again; one that refuses it for good has it given up
 * on, and Settings says so; a message past its time is given up on, and one
 * older than 90 days is gone. What a message said is kept only until it is sent.
 * A test from Settings reaches whoever asked for it.
 *
 *   node tests/email-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]
 *
 * The server is to send to the relay stand-in (tests/smtp-stand-in.mjs), read
 * back at http://127.0.0.1:2526 unless said. Needs the database the server
 * uses: it leaves nothing it made.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const [, , base, fullEmail, fullPassword, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail || !fullPassword) {
	console.error(
		'usage: node tests/email-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]'
	);
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
	console.log(`  ${ok ? '✓' : '✗'} ${what}`);
};

const sessionOf = (/** @type {Response} */ r) =>
	(r.headers.getSetCookie?.() ?? [])
		.map((c) => c.split(';')[0])
		.filter((c) => c.includes('session_token='))
		.join('; ');
const signIn = async (/** @type {string} */ email, /** @type {string} */ password) =>
	sessionOf(
		await fetch(`${base}/login`, {
			method: 'POST',
			body: new URLSearchParams({ email, password, next: '/' }),
			redirect: 'manual',
			headers: { origin: base, ...PROXY }
		})
	);
const as =
	(/** @type {string} */ cookie) =>
	(/** @type {string} */ path, /** @type {RequestInit} */ init = {}) =>
		fetch(base + path, {
			redirect: 'manual',
			...init,
			headers: { cookie, origin: base, ...PROXY, ...(init.headers ?? {}) }
		});
const form = (/** @type {Record<string, string>} */ fields) => ({
	method: 'POST',
	body: new URLSearchParams(fields),
	headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }
});

/** @typedef {{ from: string, to: string[], data: string, at: string }} Taken */

/** What the relay has taken, its bodies decoded from quoted-printable. */
async function inbox() {
	const taken = /** @type {Taken[]} */ (await (await fetch(`${relay}/messages`)).json());
	return taken.map((m) => ({ ...m, text: decoded(m.data) }));
}
/** A message body as written, from the quoted-printable nodemailer sends long lines as. */
const decoded = (/** @type {string} */ data) => {
	const joined = data.replace(/=\r\n/g, '');
	const bytes = [];
	for (let i = 0; i < joined.length; i++) {
		const hex = /^=([0-9A-F]{2})/.exec(joined.slice(i, i + 3));
		if (hex) {
			bytes.push(parseInt(hex[1], 16));
			i += 2;
		} else bytes.push(...Buffer.from(joined[i]));
	}
	return Buffer.from(bytes).toString('utf8');
};
/** The first message to `to` whose text has every one of `says`, waited for a while. */
async function arrives(/** @type {string} */ to, /** @type {string[]} */ says, seconds = 15) {
	for (let i = 0; i < seconds * 4; i++) {
		const found = (await inbox()).find(
			(m) => m.to.includes(to) && says.every((s) => m.text.includes(s))
		);
		if (found) return found;
		await new Promise((r) => setTimeout(r, 250));
	}
	return null;
}

const db = new pg.Client(database());
await db.connect();
const nudge = () => db.query(`select pg_notify('email_message', '')`);
/** The email rows about a person, newest first. */
const rowsAbout = async (/** @type {string} */ userId) =>
	(
		await db.query(
			`select kind, to_address, body, tries, sent_at, gave_up_at, last_error, next_try_at > now() as later
			   from email_message where user_id = $1 order by created_at desc`,
			[userId]
		)
	).rows;

const fullCookie = await signIn(fullEmail, fullPassword);
if (!fullCookie) {
	console.error(`  could not sign in as ${fullEmail}`);
	process.exit(1);
}
const asFull = as(fullCookie);
const [{ name: fullName }] = (
	await db.query('select name from "user" where email = $1', [fullEmail.toLowerCase()])
).rows;
const [business] = (await db.query('select trading_name, email from operator limit 1')).rows;
const tag = crypto.randomUUID().slice(0, 8);
const email = `told-${tag}@kestrel.example`;
/** @type {string | null} */
let id = null;
/** @type {string[]} */
const addresses = [email];

try {
	const added = await asFull('/api/people', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			fields: { name: 'Rowan Told', email, role_id: '', access: 'field' }
		})
	});
	const made = added.status === 201 ? await added.json() : null;
	id = made?.id ?? null;
	if (!id) throw new Error(`nobody was added (${added.status})`);
	check((await rowsAbout(id)).length === 0, 'adding a person tells them nothing yet');

	// ------------------------------------------------- told of changes ----
	const asThem = as(await signIn(email, made.password));
	const chosen = 'chosen-after-the-handover';
	await asThem('/new-password', form({ password: chosen, confirm: chosen }));
	const one = await arrives(email, ['your password was changed', 'when you chose it']);
	check(!!one, 'choosing one after a handover tells them so, by email');

	if (one) {
		const head = one.data.slice(0, one.data.indexOf('\r\n\r\n'));
		check(
			head.includes(`From: ${business.trading_name} <`) && one.from.endsWith('@kestrel.example'),
			'it comes from the business, at the address reckon sends as',
			head.match(/^From: .*$/m)?.[0]
		);
		check(
			!business.email || head.includes(`Reply-To: ${business.email}`),
			'and a reply goes to the business',
			head.match(/^Reply-To: .*$/m)?.[0] ?? 'no Reply-To'
		);
		check(
			/^Auto-Submitted: auto-generated$/m.test(head),
			'marked as a machine’s, so nothing replies to it automatically'
		);
		check(
			/^Message-ID: <[0-9a-f-]{36}@kestrel\.example>$/im.test(head),
			'its Message-ID the row’s own, on the sending domain',
			head.match(/^Message-ID: .*$/im)?.[0]
		);
		check(
			one.text.includes('Ask someone with Full access') &&
				(!business.email || one.text.includes(business.email)),
			'and it says who to ask if it was not them'
		);
	}
	const [row] = await rowsAbout(id);
	check(
		row?.sent_at !== null && row?.body === null,
		'once sent, what it said is no longer kept',
		JSON.stringify({ sent: !!row?.sent_at, body: row?.body !== null })
	);

	const changed = 'changed-on-their-profile';
	await asThem('/profile/password', form({ current: chosen, password: changed, confirm: changed }));
	check(
		!!(await arrives(email, ['your password was changed', 'on Your profile'])),
		'changing it on Your profile tells them'
	);

	const shell = 'set-at-the-command-line';
	const ran = spawnSync('node', ['scripts/user.mjs', 'password', email], {
		input: `${shell}\n${shell}\n`,
		encoding: 'utf8'
	});
	check(
		ran.status === 0 && !!(await arrives(email, ['at the command line'])),
		'setting it at the command line tells them, sent by the server',
		ran.stderr.trim()
	);

	await asFull(`/api/people/${id}/password`, { method: 'POST' });
	check(
		!!(await arrives(email, ['your password was reset', `${fullName} reset the password`])),
		'a reset on Team tells them, naming who reset it'
	);

	// ----------------------------------------------- a relay in trouble ----
	const later = `later-${tag}@kestrel.example`;
	addresses.push(later);
	await db.query('update "user" set email = $2 where id = $1', [id, later]);
	await asFull(`/api/people/${id}/password`, { method: 'POST' });
	await new Promise((r) => setTimeout(r, 1500));
	const [putOff] = await rowsAbout(id);
	check(
		putOff?.sent_at === null &&
			putOff?.gave_up_at === null &&
			putOff?.tries === 1 &&
			putOff?.later &&
			putOff?.body !== null &&
			/451/.test(putOff?.last_error ?? ''),
		'a message the relay puts off waits to be tried again, saying why',
		JSON.stringify(putOff)
	);
	await db.query(
		`update email_message set next_try_at = now() where user_id = $1 and sent_at is null`,
		[id]
	);
	await nudge();
	check(!!(await arrives(later, ['your password was reset'])), 'and goes when it is tried again');

	const never = `never-${tag}@kestrel.example`;
	addresses.push(never);
	await db.query('update "user" set email = $2 where id = $1', [id, never]);
	await asFull(`/api/people/${id}/password`, { method: 'POST' });
	await new Promise((r) => setTimeout(r, 1500));
	const [refused] = await rowsAbout(id);
	check(
		refused?.gave_up_at !== null && refused?.body === null && /550/.test(refused?.last_error ?? ''),
		'one the relay refuses for good is given up on, keeping only why',
		JSON.stringify(refused)
	);
	const settings = await (await asFull('/settings/integrations')).text();
	check(
		settings.includes('last failed') && settings.includes('550'),
		'and Settings says so, with what the relay said'
	);

	// ------------------------------------------------ time runs out ----
	await db.query(
		`insert into email_message (kind, user_id, to_address, subject, body, send_by, next_try_at)
		 values ('password_changed', $1, $2, 'Too late', 'Hello', now() - interval '1 minute', now() + interval '1 hour')`,
		[id, email]
	);
	await db.query(
		`insert into email_message (kind, user_id, to_address, subject, send_by, sent_at, created_at)
		 values ('password_changed', $1, $2, 'Long ago', now() - interval '91 days', now() - interval '91 days', now() - interval '91 days')`,
		[id, email]
	);
	await nudge();
	await new Promise((r) => setTimeout(r, 1500));
	const late = (
		await db.query(
			`select gave_up_at, body from email_message where subject = 'Too late' and user_id = $1`,
			[id]
		)
	).rows[0];
	check(
		late?.gave_up_at !== null && late?.body === null,
		'one past its time is given up on',
		JSON.stringify(late)
	);
	const old = await db.query(
		`select 1 from email_message where subject = 'Long ago' and user_id = $1`,
		[id]
	);
	check(old.rowCount === 0, 'and one older than 90 days is gone');

	// ---------------------------------------------------------- a test ----
	const tested = await asFull('/settings/integrations?/test', form({}));
	const testPage = await tested.text();
	check(
		tested.status === 200 && testPage.includes(`Sent to ${fullEmail.toLowerCase()}`),
		'a test from Settings says it was sent',
		String(tested.status)
	);
	check(
		!!(await arrives(fullEmail.toLowerCase(), ['a test of email', 'reckon can send email'])),
		'and it reaches whoever asked for it'
	);
} catch (e) {
	const why = e instanceof Error ? e.message : String(e);
	failures.push(why);
	console.log(`  ✗ ${why}`);
} finally {
	if (id) await db.query('delete from "user" where id = $1', [id]);
	await db.query('delete from email_message where to_address = any($1)', [addresses]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
