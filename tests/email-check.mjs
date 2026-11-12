#!/usr/bin/env node
/**
 * Proves reckon sends email (#lib/server/email): a person added on Team is
 * invited by email, and told whenever their passkeys change -- one made with
 * the link, one removed on Your profile, a new link sent on Team -- and the
 * email goes through the relay as the business, marked as a machine's,
 * as plain text and as HTML, the text first, a logo carried inside it. A relay
 * that puts a
 * message off has it tried again; one that refuses it for good has it given up
 * on, and Settings says so; a message past its time is given up on, and one
 * older than 90 days is gone. What a message said is kept only until it is sent.
 * A test from Settings reaches whoever asked for it.
 *
 *   node tests/email-check.mjs <base-url> <full-email> [relay-read-back-url]
 *
 * The server is to send to the relay stand-in (tests/smtp-stand-in.mjs), read
 * back at http://127.0.0.1:2526 unless said. Needs the database the server
 * uses. The person it adds is left inactive, as anyone in the security log
 * is, never deleted; the email it made is gone.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { arrives as arrivesAt, linkIn } from './relay.mjs';
import { makePasskey, signIn } from './passkeys.mjs';

const [, , base, fullEmail, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail) {
	console.error('usage: node tests/email-check.mjs <base-url> <full-email> [relay-read-back-url]');
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

const arrives = (/** @type {string} */ to, /** @type {string[]} */ says, seconds = 15) =>
	arrivesAt(relay, to, says, seconds);

const db = new pg.Client(database());
await db.connect();
const nudge = () => db.query(`select pg_notify('email_message', '')`);
/** The email rows about a person, newest first. */
const rowsAbout = async (/** @type {string} */ userId) =>
	(
		await db.query(
			`select kind, to_address, body, html, tries, sent_at, gave_up_at, last_error, next_try_at > now() as later
			   from email_message where user_id = $1 order by created_at desc`,
			[userId]
		)
	).rows;

const asFull = as((await signIn(base, fullEmail)).cookie);
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
	const one = await arrives(email, ['make your passkey', `${fullName} added you`]);
	check(!!one, 'adding a person invites them, by email');

	// ------------------------------------------------- told of changes ----
	const joined = await makePasskey(base, linkIn(one)?.code ?? '');
	const asThem = as(joined?.cookie ?? '');
	check(
		!!joined && !!(await arrives(email, ['a passkey was added'])),
		'making a passkey with the link tells them so'
	);

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
		const textAt = one.data.search(/^Content-Type: text\/plain/im);
		const htmlAt = one.data.search(/^Content-Type: text\/html/im);
		check(
			/^Content-Type: multipart\/alternative/im.test(one.data) && textAt > 0 && htmlAt > textAt,
			'it goes as plain text and as HTML, the text first (RFC 2046 §5.1.4)',
			`text at ${textAt}, html at ${htmlAt}`
		);
		check(
			one.text.includes('<title>') &&
				one.text.includes('role="presentation"') &&
				one.text.includes('>Make your passkey</a>'),
			'its HTML is laid out, with the link as a button'
		);
		check(
			one.text.includes(`Ask ${fullName} about it`) &&
				(!business.email || one.text.includes(business.email)),
			'and it says who to ask if it was not expected'
		);
	}
	const [row] = await rowsAbout(id);
	check(
		row?.sent_at !== null && row?.body === null && row?.html === null,
		'once sent, what it said is no longer kept, as text or as HTML',
		JSON.stringify({ sent: !!row?.sent_at, body: row?.body !== null, html: row?.html !== null })
	);

	const [{ id: theirs }] = (await db.query('select id from passkey where user_id = $1', [id])).rows;
	await asThem('/profile/passkeys?/remove', {
		...form({ id: theirs }),
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sveltekit-action': 'true' }
	});
	check(
		!!(await arrives(email, ['a passkey was removed'])),
		'removing it on Your profile tells them'
	);

	const ran = spawnSync('node', ['scripts/user.mjs', 'invite', email], { encoding: 'utf8' });
	check(
		ran.status === 0 && /\/link#[A-Za-z0-9_-]{43}/.test(ran.stdout),
		'the command line gives a new link, printed to hand over',
		ran.stderr.trim()
	);

	await asFull(`/api/people/${id}/link`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ lost: false })
	});
	check(
		!!(await arrives(email, ['a link to make a new passkey', `${fullName} sent you this link`])),
		'a new link from Team is emailed, naming who sent it'
	);

	// ---------------------------------------------- told of Team's changes ----
	const patch = (/** @type {Record<string, unknown>} */ body) =>
		asFull(`/api/people/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	await patch({ fields: { name: 'Rowan Told-Again' } });
	check(
		!!(await arrives(email, [
			'your name was changed',
			'from Rowan Told to Rowan Told-Again',
			fullName
		])),
		'a new name from Team is emailed, with the old one and who changed it'
	);
	await patch({ fields: { access: 'full' } });
	check(
		!!(await arrives(email, ['what you can reach changed', 'from Field to Full', fullName])),
		'Full given on Team is emailed, from and to'
	);
	await patch({ fields: { access: 'field' } });
	check(
		!!(await arrives(email, ['what you can reach changed', 'from Full to Field'])),
		'and taken back'
	);
	const silent = await patch({ fields: { active: 'false' } });
	check(silent.status === 400, 'nobody is made inactive without saying why', String(silent.status));
	await patch({ fields: { active: 'false' }, reason: 'The season is over.' });
	check(
		!!(await arrives(email, [
			'you were made inactive',
			'They said: The season is over.',
			fullName
		])),
		'made inactive, they are emailed why, and by whom'
	);
	await patch({ fields: { active: 'true' } });
	check(
		!!(await arrives(email, ['you can sign in again', fullName])),
		'and made active again, they are told they can sign in'
	);

	// ----------------------------------------------- a relay in trouble ----
	const later = `later-${tag}@kestrel.example`;
	addresses.push(later);
	await db.query('update "user" set email = $2 where id = $1', [id, later]);
	await asFull(`/api/people/${id}/link`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ lost: false })
	});
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
	check(
		!!(await arrives(later, ['a link to make a new passkey'])),
		'and goes when it is tried again'
	);

	const never = `never-${tag}@kestrel.example`;
	addresses.push(never);
	await db.query('update "user" set email = $2 where id = $1', [id, never]);
	await asFull(`/api/people/${id}/link`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ lost: false })
	});
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
		 values ('passkey_added', $1, $2, 'Too late', 'Hello', now() - interval '1 minute', now() + interval '1 hour')`,
		[id, email]
	);
	await db.query(
		`insert into email_message (kind, user_id, to_address, subject, send_by, sent_at, created_at)
		 values ('passkey_added', $1, $2, 'Long ago', now() - interval '91 days', now() - interval '91 days', now() - interval '91 days')`,
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

	// ------------------------------------------------------ with a logo ----
	const [kept] = (await db.query('select logo, logo_media_type from operator limit 1')).rows;
	// The smallest PNG there is: one pixel.
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
		'base64'
	);
	await db.query(`update operator set logo = $1, logo_media_type = 'image/png'`, [png]);
	try {
		await asFull('/settings/integrations?/test', form({}));
		const withLogo = await arrives(fullEmail.toLowerCase(), ['a test of email', 'cid:logo@reckon']);
		check(
			!!withLogo &&
				/^Content-ID: <logo@reckon>$/im.test(withLogo.data) &&
				/^Content-Disposition: inline/im.test(withLogo.data),
			'with a logo, it is carried inside the message, not fetched from anywhere'
		);
	} finally {
		await db.query('update operator set logo = $1, logo_media_type = $2', [
			kept?.logo ?? null,
			kept?.logo_media_type ?? null
		]);
	}
} catch (e) {
	const why = e instanceof Error ? e.message : String(e);
	failures.push(why);
	console.log(`  ✗ ${why}`);
} finally {
	if (id) await db.query('update "user" set active = false where id = $1', [id]);
	await db.query('delete from email_message where to_address = any($1)', [addresses]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
