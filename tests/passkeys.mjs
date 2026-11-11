/**
 * Signing the checks in, with passkeys: everyone signs in with one
 * (#lib/server/passkeys), the people the checks act as included.
 *
 * enrol() gives each of them a passkey the way the first person gets theirs --
 * `scripts/user.mjs invite` prints a link, and a passkey is made with it on the
 * link's page -- and keeps them in a file (RECKON_TEST_PASSKEYS, or one in the
 * temporary directory). signIn() signs in as one of them, as the sign-in page
 * does, for any check after. The passkeys are software ones
 * (tests/soft-passkey.mjs); nothing here is used by reckon itself.
 *
 *   node tests/passkeys.mjs <base-url> <email>...
 *
 * enrols each email given, against a running server whose SITE_URL is the
 * address given, with the database the server uses.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'devalue';
import { softPasskeys } from './soft-passkey.mjs';

/** Where the passkeys are kept between the checks of a run. */
export const PASSKEYS =
	process.env.RECKON_TEST_PASSKEYS || join(tmpdir(), 'reckon-test-passkeys.json');

/**
 * In production a TLS proxy stands in front; over plain http this says what it would.
 *
 * @returns {Record<string, string>}
 */
const proxy = (/** @type {string} */ base) =>
	base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

/** The cookies a response set, as a Cookie header would send them back. */
const cookiesOf = (/** @type {Response} */ r) =>
	r.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.filter((c) => /=./.test(c))
		.join('; ');

/** @returns {Record<string, import('./soft-passkey.mjs').KeptPasskey>} */
function kept() {
	try {
		return JSON.parse(readFileSync(PASSKEYS, 'utf8'));
	} catch {
		return {};
	}
}

/**
 * A passkey made with a link's code, as the link's page makes one: the
 * software passkey holding it, and the session it signed them in with, as a
 * Cookie header. Null if the link would not begin one, or it was not kept.
 *
 * @param {string} base
 * @param {string} code
 */
export async function makePasskey(base, code) {
	const begun = await fetch(`${base}/link?/begin`, {
		method: 'POST',
		body: new URLSearchParams({ code }),
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'x-sveltekit-action': 'true',
			origin: base,
			...proxy(base)
		}
	});
	const answer = JSON.parse(await begun.text());
	if (answer.type !== 'success') return null;
	const { options } = parse(answer.data);
	const keys = softPasskeys({ origin: base });
	const made = await fetch(`${base}/api/auth/passkey/verify-registration`, {
		method: 'POST',
		body: JSON.stringify({ response: keys.create(options), createSession: true }),
		headers: {
			'content-type': 'application/json',
			cookie: cookiesOf(begun),
			origin: base,
			...proxy(base)
		}
	});
	if (!made.ok) return null;
	const session =
		made.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.find((c) => /session_token=./.test(c)) ?? '';
	return { keys, cookie: session };
}

/**
 * Gives `email` a passkey, as the first person is given theirs: an invitation
 * link from the command line, and a passkey made with it on the link's page.
 * Kept for signIn().
 *
 * @param {string} base
 * @param {string} email
 */
export async function enrol(base, email) {
	const said = execFileSync(process.execPath, ['scripts/user.mjs', 'invite', email], {
		encoding: 'utf8'
	});
	const code = /\/link#([A-Za-z0-9_-]{43})/.exec(said)?.[1];
	if (!code) throw new Error(`no link for ${email}: ${said}`);
	const made = await makePasskey(base, code);
	if (!made) throw new Error(`no passkey was made for ${email}`);
	writeFileSync(PASSKEYS, JSON.stringify({ ...kept(), [email]: made.keys.export()[0] }), {
		mode: 0o600
	});
}

/**
 * Signs in as `email` with the passkey enrol() gave them, as the sign-in page
 * does: the session cookie, as a Cookie header, and its name and value apart.
 *
 * @param {string} base
 * @param {string} email
 */
export async function signIn(base, email) {
	const key = kept()[email];
	if (!key) throw new Error(`no passkey kept for ${email}: run tests/passkeys.mjs first`);
	const signed = await signInWith(base, softPasskeys({ origin: base, keys: [key] }));
	if (!signed) throw new Error(`could not sign in as ${email}`);
	return signed;
}

/**
 * Signs in with a passkey a software authenticator holds: the session cookie,
 * as a Cookie header, and its name and value apart; or null, refused.
 *
 * @param {string} base
 * @param {ReturnType<typeof softPasskeys>} keys
 */
export async function signInWith(base, keys) {
	const asked = await fetch(`${base}/api/auth/passkey/generate-authenticate-options`, {
		headers: { origin: base, ...proxy(base) }
	});
	const r = await fetch(`${base}/api/auth/passkey/verify-authentication`, {
		method: 'POST',
		body: JSON.stringify({ response: keys.get(await asked.json()) }),
		headers: {
			'content-type': 'application/json',
			cookie: cookiesOf(asked),
			origin: base,
			...proxy(base)
		}
	});
	const session = r.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.find((c) => /session_token=./.test(c));
	if (!r.ok || !session) return null;
	const at = session.indexOf('=');
	return { cookie: session, name: session.slice(0, at), value: session.slice(at + 1) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [, , base, ...emails] = process.argv;
	if (!base || !emails.length) {
		console.error('usage: node tests/passkeys.mjs <base-url> <email>...');
		process.exit(2);
	}
	for (const email of emails) {
		await enrol(base, email);
		console.log(`  ✓ ${email} has a passkey, made with the link scripts/user.mjs gave`);
	}
}
