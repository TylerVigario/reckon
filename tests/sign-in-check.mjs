#!/usr/bin/env node
/**
 * Proves the pages a passkey is made and used on work in a browser: an
 * invitation's link makes one with the browser's own WebAuthn, and the sign-in
 * page signs in with it. The other checks sign in with a software passkey over
 * HTTP (tests/passkeys.mjs); this goes through the pages themselves.
 *
 *   node tests/sign-in-check.mjs <base-url> <full-email> [relay-read-back-url]
 *
 * Uses the browser on 9222 with a virtual authenticator of Chrome's own, which
 * checks who is holding it as a phone does. Someone with Full adds a person,
 * whose invitation the relay stand-in reads back; they and their passkey go
 * at the end, and the browser's cookies are left signed out.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import pg from 'pg';
import { arrives, linkIn } from './relay.mjs';
import { signIn } from './passkeys.mjs';

const [, , base, fullEmail, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail) {
	console.error(
		'usage: node tests/sign-in-check.mjs <base-url> <full-email> [relay-read-back-url]'
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

const targets = /** @type {{ type: string; webSocketDebuggerUrl: string }[]} */ (
	await (await fetch('http://127.0.0.1:9222/json')).json()
);
const target = targets.find((t) => t.type === 'page');
if (!target) {
	console.error('No browser on 9222. Start headless_shell with --remote-debugging-port=9222.');
	process.exit(2);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (/** @type {{ data: string }} */ m) => {
	const x = JSON.parse(m.data);
	if (x.id && waiting.has(x.id)) waiting.get(x.id)(x);
};
/** @returns {Promise<any>} */
const send = (/** @type {string} */ method, /** @type {Record<string, unknown>} */ params = {}) =>
	new Promise((res) => {
		const n = ++id;
		waiting.set(n, res);
		ws.send(JSON.stringify({ id: n, method, params }));
	});
const evaluate = async (/** @type {string} */ expression) =>
	(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
		?.result?.value;
const settle = (ms = 2000) => new Promise((r) => setTimeout(r, ms));
const go = async (/** @type {string} */ path) => {
	await send('Page.navigate', { url: base + path });
	await settle(2500);
};
/** The text of the page's <main>, on one line. */
const main = () =>
	evaluate(`document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`);
/** Presses the page's button that says `label`, as a person would. */
const press = (/** @type {string} */ label) =>
	evaluate(`(() => {
		const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
		if (!b) return false;
		b.click();
		return true;
	})()`);

await send('Page.enable');
await send('Runtime.enable');
if (base.startsWith('http:'))
	await send('Network.enable').then(() =>
		send('Network.setExtraHTTPHeaders', { headers: { 'x-forwarded-proto': 'http' } })
	);

const client = new pg.Client(database());
await client.connect();
const quinn = `quinn.arbor.${Date.now().toString(36)}@kestrel.example`;
let quinnId = '';
/** @type {string | null} */
let authenticator = null;

try {
	// Someone with Full adds a person, who is emailed an invitation.
	const { cookie } = await signIn(base, fullEmail);
	const added = await fetch(`${base}/api/people`, {
		method: 'POST',
		body: JSON.stringify({
			fields: { name: 'Quinn Arbor', email: quinn, role_id: '', access: 'field' }
		}),
		headers: { 'content-type': 'application/json', cookie, origin: base, ...PROXY }
	});
	quinnId = added.status === 201 ? (await added.json()).id : '';
	if (!quinnId) throw new Error(`nobody was added (${added.status})`);
	const code = linkIn(await arrives(relay, quinn, ['make your passkey']))?.code;
	if (!code) throw new Error('no invitation arrived');

	// Their phone, with a passkey manager that checks who is holding it.
	await send('Network.clearBrowserCookies');
	await send('WebAuthn.enable');
	authenticator = (
		await send('WebAuthn.addVirtualAuthenticator', {
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true
			}
		})
	).result?.authenticatorId;
	if (!authenticator) throw new Error('the browser would not add a virtual authenticator');

	// The invitation's link makes a passkey.
	await go(`/link#${code}`);
	check(
		(await main()).includes('Make a passkey to sign in as'),
		'the invitation’s link says what a passkey is, and offers to make one'
	);
	check(await press('Make your passkey'), 'and has a button to make it');
	await settle(3000);
	check((await main()).includes('Passkey made'), 'the browser makes the passkey, and it is kept');
	const made = (await send('WebAuthn.getCredentials', { authenticatorId: authenticator })).result
		?.credentials;
	check(
		made?.length === 1 && made[0].isResidentCredential === true,
		'one passkey is on the phone, found without an address typed (discoverable)'
	);
	await go('/');
	check(
		(await evaluate('location.pathname')) === '/',
		'and they are signed in with it, there and then'
	);

	// Signed out, the sign-in page signs them back in with it. The phone waits
	// to be touched, so the page can be looked at first.
	await send('Network.clearBrowserCookies');
	await send('WebAuthn.setAutomaticPresenceSimulation', {
		authenticatorId: authenticator,
		enabled: false
	});
	await go('/login');
	check(
		(await main()).includes('Sign in with a passkey') &&
			!(await main()).includes('can’t be used in this browser'),
		'the sign-in page offers the passkey'
	);
	check(
		(await evaluate(`document.querySelector('input[name=email]')?.autocomplete`)) ===
			'username webauthn',
		'and its email field offers saved passkeys as it is filled (autofill)'
	);
	await send('WebAuthn.setAutomaticPresenceSimulation', {
		authenticatorId: authenticator,
		enabled: true
	});
	check(await press('Sign in with a passkey'), 'and has a button for the browser’s passkey dialog');
	await settle(3000);
	check(
		(await evaluate('location.pathname')) === '/',
		'pressing it signs them in with the passkey',
		String(await evaluate('location.pathname'))
	);

	// And the browser's autofill, offered as the page opens, signs them in when
	// the passkey is chosen -- here, by a phone that answers at once.
	await send('Network.clearBrowserCookies');
	await go('/login');
	await settle(2000);
	check(
		(await evaluate('location.pathname')) === '/',
		'autofill signs them in when the passkey is chosen, with no button pressed',
		String(await evaluate('location.pathname'))
	);
	const [{ last }] = (
		await client.query('select max(last_used_at) as last from passkey where user_id = $1', [
			quinnId
		])
	).rows;
	check(!!last, 'and the passkey is noted as used');
} finally {
	if (authenticator)
		await send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authenticator });
	await send('Network.clearBrowserCookies');
	if (quinnId) {
		await client.query('delete from passkey where user_id = $1', [quinnId]);
		await client.query('update "user" set active = false where id = $1', [quinnId]);
	}
	await client.end();
	ws.close();
}

if (failures.length) {
	console.error(`\n${failures.length} of ${passed + failures.length} failed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`\n${passed} checks of making and using a passkey in a browser passed.`);
