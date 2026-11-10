#!/usr/bin/env node
/**
 * Proves forgot password (#lib/server/recovery): sign-in offers it; the page
 * gives one answer whatever the address; a confirmed address is emailed a
 * link good once for an hour, and the password works until it is used; an
 * address asked for again within minutes is sent nothing more; one not
 * confirmed is told so without a link; an unknown or a deactivated person's is
 * sent nothing; using the link chooses a new password, ends every session and
 * tells them; and a network that asks too often waits.
 *
 *   node tests/forgot-password-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]
 *
 * The server sends to the relay stand-in (tests/smtp-stand-in.mjs), read back
 * at http://127.0.0.1:2526 unless said, with SITE_URL the base url. Over HTTP,
 * the way a browser does it. Needs the database the server uses: it leaves
 * nothing it made.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import pg from 'pg';
import { arrives, linkAction, linkIn } from './relay.mjs';

const [, , base, fullEmail, fullPassword, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail || !fullPassword) {
	console.error(
		'usage: node tests/forgot-password-check.mjs <base-url> <full-email> <full-password> [relay-read-back-url]'
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

/** The session cookie a sign-in sets, or '' when it was refused. */
const signIn = async (/** @type {string} */ email, /** @type {string} */ password) =>
	(
		await fetch(`${base}/login`, {
			method: 'POST',
			body: new URLSearchParams({ email, password, next: '/' }),
			redirect: 'manual',
			headers: { origin: base, ...PROXY }
		})
	).headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.filter((c) => c.includes('session_token='))
		.join('; ');

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

/** Forgot password asked for, as the page's form posts it, signed out: the page it answers with. */
const ask = async (/** @type {string} */ email) => {
	const r = await fetch(`${base}/forgot-password`, {
		method: 'POST',
		body: new URLSearchParams({ email }),
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
			origin: base,
			...PROXY
		}
	});
	const html = await r.text();
	// What the page says: its card, without the markup SvelteKit adds around it.
	const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
	return {
		status: r.status,
		said: main
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	};
};

/** One of the link page's actions, as its page posts it. */
const act = (
	/** @type {'look' | 'choose' | 'confirm' | 'change'} */ name,
	/** @type {Record<string, string>} */ fields
) => linkAction(base, name, fields, PROXY);

const db = new pg.Client(database());
await db.connect();
/** Whose network the server sees these checks come from: this machine. */
const HERE = '127.0.0.1/32';
/** How many emails of these kinds went to an address. */
const told = async (/** @type {string} */ to, /** @type {string[]} */ kinds) =>
	(
		await db.query(
			'select count(*)::int as n from email_message where to_address = $1 and kind = any($2)',
			[to, kinds]
		)
	).rows[0].n;
const RECOVERY = ['password_recovery', 'password_recovery_unconfirmed'];

const fullCookie = await signIn(fullEmail, fullPassword);
if (!fullCookie) {
	console.error(`  could not sign in as ${fullEmail}`);
	process.exit(1);
}
const asFull = as(fullCookie);
const tag = crypto.randomUUID().slice(0, 8);
const quinn = `quinn-${tag}@kestrel.example`;
const jun = `jun-${tag}@kestrel.example`;
const dale = `dale-${tag}@kestrel.example`;
const nobody = `nobody-${tag}@kestrel.example`;
/** @type {string[]} */
const made = [];
const addresses = [quinn, jun, dale, nobody];
const first = 'quinns-first-password';
const second = 'quinns-second-password';
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

try {
	await db.query('delete from recovery_ask where network = $1', [HERE]);
	// Quinn has chosen a password, so their address is confirmed; Jun is yet
	// to, so theirs is not; Dale is deactivated.
	const quinnId = await add('Quinn Harper', quinn);
	const invite = linkIn(await arrives(relay, quinn, ['choose your password']))?.code ?? '';
	await act('choose', { code: invite, password: first, confirm: first });
	await add('Jun Hale', jun);
	const daleId = await add('Dale Moss', dale);
	await asFull(`/api/people/${daleId}`, send('PATCH', { fields: { active: 'false' } }));

	// ------------------------------------------------------- the pages ----
	const login = await (await fetch(`${base}/login`, { headers: PROXY })).text();
	check(
		/href="[^"]*\/forgot-password"[^>]*>Forgot password\?</.test(login),
		'sign-in offers Forgot password?'
	);
	const page = await fetch(`${base}/forgot-password`, { headers: PROXY });
	check(
		page.status === 200 && (page.headers.get('cache-control') ?? '').includes('no-store'),
		'it opens without signing in, and nothing is kept of it',
		String(page.status)
	);

	// ----------------------------------------------------------- asked ----
	const known = await ask(quinn);
	const unknown = await ask(nobody);
	check(
		known.status === 200 && known.said.includes('Check your email'),
		'asking answers that an email is on its way if the address is someone’s',
		String(known.status)
	);
	check(
		known.said.length > 0 &&
			known.said.replaceAll(quinn, '@') === unknown.said.replaceAll(nobody, '@'),
		'and answers the same for an address nobody signs in with'
	);
	const mail = await arrives(relay, quinn, ['choose a new password', 'someone asked']);
	const code = linkIn(mail)?.code ?? '';
	check(!!code, 'a confirmed address is emailed a link');
	const [kept] = (
		await db.query(
			`select expires_at - created_at = interval '1 hour' as an_hour from email_link
			  where user_id = $1 and purpose = 'recover' and used_at is null`,
			[quinnId]
		)
	).rows;
	check(!!kept?.an_hour, 'which works for an hour');
	const stillIn = await signIn(quinn, first);
	check(!!stillIn, 'and their password still works until it is used');

	const again = await ask(quinn);
	await new Promise((r) => setTimeout(r, 1500));
	check(
		again.status === 200 && (await told(quinn, RECOVERY)) === 1,
		'asked again within minutes, the address is sent nothing more',
		`${await told(quinn, RECOVERY)} sent`
	);

	await ask(jun);
	const unconfirmed = await arrives(relay, jun, ['choosing a new password']);
	check(
		!!unconfirmed &&
			!linkIn(unconfirmed) &&
			unconfirmed.text.includes("This address hasn't been confirmed"),
		'an address not confirmed is told so, with no link'
	);
	await ask(dale);
	await new Promise((r) => setTimeout(r, 1500));
	check((await told(nobody, RECOVERY)) === 0, 'an unknown address is sent nothing');
	check((await told(dale, RECOVERY)) === 0, 'nor is a deactivated person’s');

	// ------------------------------------------------------------ used ----
	const looked = await act('look', { code });
	check(
		looked.type === 'success' && looked.text.includes('recover'),
		'its code says what it is for'
	);
	const chose = await act('choose', { code, password: second, confirm: second });
	check(chose.type === 'success', 'with it, a new password is chosen');
	check(!(await signIn(quinn, first)), 'the old one no longer works');
	check(!!(await signIn(quinn, second)), 'and the new one does');
	const ended = await as(stillIn)('/profile');
	check(ended.status === 303, 'every session they had is ended', String(ended.status));
	check(
		!!(await arrives(relay, quinn, [
			'your password was changed',
			'with a link reckon emailed you'
		])),
		'and they are told'
	);
	check(
		(await act('choose', { code, password: first, confirm: first })).type === 'failure',
		'the link works once'
	);

	// ---------------------------------------------------- too many asks ----
	await db.query('delete from recovery_ask where network = $1', [HERE]);
	for (let i = 0; i < 10; i++) await ask(`nobody-${tag}-${i}@kestrel.example`);
	// Each ask is counted just after it is answered.
	await new Promise((r) => setTimeout(r, 1000));
	const turned = await ask(`nobody-${tag}-x@kestrel.example`);
	check(
		turned.status === 429 && turned.said.includes('Too many tries from here'),
		'ten asks from one network in a quarter of an hour, and it waits',
		String(turned.status)
	);
} catch (e) {
	const why = e instanceof Error ? e.message : String(e);
	failures.push(why);
	console.log(`  ✗ ${why}`);
} finally {
	for (const who of made) await db.query('delete from "user" where id = $1', [who]);
	await db.query('delete from email_message where to_address = any($1)', [addresses]);
	await db.query('delete from recovery_ask where network = $1', [HERE]);
	await db.query('delete from link_try where network = $1', [HERE]);
	await db.end();
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
