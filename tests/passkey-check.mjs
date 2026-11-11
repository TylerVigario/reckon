#!/usr/bin/env node
/**
 * Proves passkeys (#lib/server/passkeys): made with an invitation and with a
 * new link from Team, made on Your profile, signed in with, refused where they
 * should be, ended for a phone lost or stolen, and removed. Against a running server whose SITE_URL is the
 * address given -- a host name, since WebAuthn takes no IP address -- with a
 * relay stand-in reading back what it sent.
 *
 *   node tests/passkey-check.mjs <base-url> <full-email> [relay-read-back-url]
 *
 * The passkeys are software ones (tests/soft-passkey.mjs), made and used as a
 * phone's would be. Needs the database the server uses, to leave nothing
 * behind: the person it adds and the passkeys it makes go at the end.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import { parse } from 'devalue';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { arrives, linkIn } from './relay.mjs';
import { softPasskeys } from './soft-passkey.mjs';
import { signIn } from './passkeys.mjs';

const [, , base, fullEmail, relay = 'http://127.0.0.1:2526'] = process.argv;
if (!base || !fullEmail) {
	console.error(
		'usage: node tests/passkey-check.mjs <base-url> <full-email> [relay-read-back-url]'
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

/** A browser's cookies, kept as a browser keeps them: set, replaced and taken away. */
function jar() {
	/** @type {Map<string, string>} */
	const kept = new Map();
	return {
		/** @param {Response} r */
		take(r) {
			for (const c of r.headers.getSetCookie()) {
				const [pair, ...attrs] = c.split(';');
				const at = pair.indexOf('=');
				const name = pair.slice(0, at).trim();
				const value = pair.slice(at + 1);
				const gone = !value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
				if (gone) kept.delete(name);
				else kept.set(name, value);
			}
		},
		header: () => [...kept].map(([k, v]) => `${k}=${v}`).join('; '),
		/** @param {{ name: string, value: string }} c */
		set: (c) => kept.set(c.name, c.value),
		signedIn: () => [...kept.keys()].some((k) => k.endsWith('session_token'))
	};
}

/** What two browsers say they are. */
const SAFARI_ON_IPHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const EDGE_ON_WINDOWS =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';

/** A browser: its own cookies, and what it asks -- saying what it is, where given. */
function browser(/** @type {string} */ userAgent = '') {
	const cookies = jar();
	/** @param {string} path @param {RequestInit} [init] */
	const ask = async (path, init = {}) => {
		const r = await fetch(base + path, {
			redirect: 'manual',
			...init,
			headers: {
				origin: base,
				...PROXY,
				...(userAgent ? { 'user-agent': userAgent } : {}),
				...(cookies.header() ? { cookie: cookies.header() } : {}),
				...(init.headers ?? {})
			}
		});
		cookies.take(r);
		return r;
	};
	return { ask, cookies };
}

const json = (/** @type {string} */ method, /** @type {unknown} */ body) => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

/** One of the link page's actions, as its page posts it: its type, status and data. */
async function linkAction(
	/** @type {ReturnType<typeof browser>} */ b,
	/** @type {string} */ name,
	/** @type {Record<string, string>} */ fields
) {
	const r = await b.ask(`/link?/${name}`, {
		method: 'POST',
		body: new URLSearchParams(fields),
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sveltekit-action': 'true' }
	});
	const { type, status, data } = JSON.parse(await r.text());
	return { type, status, data: data ? parse(data) : null };
}

/** A passkey made with a link's code, as the link page makes one: what Better Auth answered. */
async function makeWithLink(
	/** @type {ReturnType<typeof browser>} */ b,
	/** @type {ReturnType<typeof softPasskeys>} */ keys,
	/** @type {string} */ code
) {
	const begun = await linkAction(b, 'begin', { code });
	if (begun.type !== 'success') return { status: begun.status, body: null };
	const r = await b.ask(
		'/api/auth/passkey/verify-registration',
		json('POST', { response: keys.create(begun.data.options), createSession: true })
	);
	return { status: r.status, body: await r.json().catch(() => null) };
}

/** A passkey made by someone signed in, as Your profile makes one. */
async function makeSignedIn(
	/** @type {ReturnType<typeof browser>} */ b,
	/** @type {ReturnType<typeof softPasskeys>} */ keys
) {
	const options = await b.ask('/api/auth/passkey/generate-register-options');
	if (!options.ok) return { status: options.status, body: null };
	const r = await b.ask(
		'/api/auth/passkey/verify-registration',
		json('POST', { response: keys.create(await options.json()) })
	);
	return { status: r.status, body: await r.json().catch(() => null) };
}

/** A sign-in with a passkey, as the sign-in page does it: what Better Auth answered. */
async function signInWith(
	/** @type {ReturnType<typeof browser>} */ b,
	/** @type {ReturnType<typeof softPasskeys>} */ keys
) {
	const options = await b.ask('/api/auth/passkey/generate-authenticate-options');
	const r = await b.ask(
		'/api/auth/passkey/verify-authentication',
		json('POST', { response: keys.get(await options.json()) })
	);
	return { status: r.status, body: await r.json().catch(() => null) };
}

/** Whether a browser is signed in: home opens, rather than sending it to sign in. */
const signedIn = async (/** @type {ReturnType<typeof browser>} */ b) =>
	(await b.ask('/')).status === 200;

const client = new pg.Client(database());
await client.connect();
const stamp = Date.now().toString(36);
const robin = `robin.vale.${stamp}@kestrel.example`;
let robinId = '';

try {
	// Someone with Full, signed in with the passkey tests/passkeys.mjs gave them.
	const full = browser();
	full.cookies.set(await signIn(base, fullEmail));

	// An invitation makes a passkey.
	const added = await full.ask(
		'/api/people',
		json('POST', { fields: { name: 'Robin Vale', email: robin, role_id: '', access: 'field' } })
	);
	robinId = added.status === 201 ? (await added.json()).id : '';
	if (!robinId) throw new Error(`nobody was added (${added.status})`);
	const invited = linkIn(await arrives(relay, robin, ['make your passkey']));
	check(!!invited, 'an invitation says to make a passkey, and carries a link');
	const code = invited?.code ?? '';

	const phone = softPasskeys({ origin: base });
	const r1 = browser(SAFARI_ON_IPHONE);
	const look = await linkAction(r1, 'look', { code });
	check(look.data?.purpose === 'invite', 'the link is looked up as an invitation');

	// Over HTTP, nobody names a link to make a passkey with.
	const forged = await browser().ask(
		`/api/auth/passkey/generate-register-options?context=${encodeURIComponent(code)}`
	);
	check(
		forged.status === 401,
		'over HTTP, no link can be named to make a passkey with',
		String(forged.status)
	);

	// One that doesn't check who is holding it is refused, and leaves the link working.
	const careless = softPasskeys({ origin: base, verifies: false });
	const refused = await makeWithLink(browser(), careless, code);
	check(
		refused.status === 403 && /fingerprint, face or screen lock/.test(refused.body?.message ?? ''),
		'a passkey that didn’t check who was holding it is refused',
		`${refused.status} ${refused.body?.message ?? ''}`
	);
	check(
		(await linkAction(browser(), 'look', { code })).type === 'success',
		'and the link still works'
	);

	const made = await makeWithLink(r1, phone, code);
	check(
		made.status === 200 && r1.cookies.signedIn(),
		'the invitation makes a passkey, and signs them in',
		String(made.status)
	);
	check(await signedIn(r1), 'signed in, home opens');
	check(
		(await linkAction(browser(), 'look', { code })).status === 404,
		'and the link no longer works'
	);
	check(
		!!(await arrives(relay, robin, ['a passkey was added'])),
		'they are told, by email, that a passkey was added'
	);
	const [{ verified }] = (
		await client.query('select email_verified as verified from "user" where id = $1', [robinId])
	).rows;
	check(verified === true, 'using the invitation proves the address theirs');
	const [{ name: madeAs }] = (
		await client.query('select name from passkey where user_id = $1', [robinId])
	).rows;
	check(
		madeAs === 'Safari on iPhone',
		'a passkey whose manager doesn’t say which it is is named for the browser it was made on',
		String(madeAs)
	);

	// Signing in with it.
	const r2 = browser(EDGE_ON_WINDOWS);
	const usedIt = await signInWith(r2, phone);
	check(
		usedIt.status === 200 && r2.cookies.signedIn(),
		'the passkey signs them in',
		String(usedIt.status)
	);
	const [{ last, lastFrom }] = (
		await client.query(
			'select last_used_at as last, last_used_from as "lastFrom" from passkey where user_id = $1',
			[robinId]
		)
	).rows;
	check(
		!!last && lastFrom === 'Edge on Windows',
		'and is noted as used, and from which browser',
		String(lastFrom)
	);
	const page = await (await r2.ask('/profile/passkeys')).text();
	check(
		page.includes('Safari on iPhone') && page.includes('from Edge on Windows'),
		'Your profile lists it by name, with when and where it was last used'
	);

	// Renamed as they like, but not to nothing.
	const [{ id: phoneId }] = (
		await client.query('select id from passkey where user_id = $1', [robinId])
	).rows;
	const rename = async (/** @type {string} */ name) =>
		JSON.parse(
			await (
				await r2.ask('/profile/passkeys?/rename', {
					method: 'POST',
					body: new URLSearchParams({ id: phoneId, name }),
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						'x-sveltekit-action': 'true'
					}
				})
			).text()
		);
	const renamed = await rename('Robin’s phone');
	const [{ name: nowCalled }] = (
		await client.query('select name from passkey where id = $1', [phoneId])
	).rows;
	check(
		renamed.type === 'success' && nowCalled === 'Robin’s phone',
		'they rename it',
		String(nowCalled)
	);
	const blank = await rename('  ');
	check(
		blank.type === 'failure' && blank.status === 400,
		'but not to nothing',
		`${blank.type} ${blank.status}`
	);

	// Refused where it should be.
	phone.verifies = false;
	const unverified = await signInWith(browser(), phone);
	check(
		unverified.status === 403,
		'a sign-in that didn’t check who was holding it is refused',
		String(unverified.status)
	);
	phone.verifies = true;

	const elsewhere = softPasskeys({ origin: 'http://evil.example' });
	const stolen = /** @type {any} */ (phone);
	const fromAfar = await (async () => {
		const b = browser();
		const options = await b.ask('/api/auth/passkey/generate-authenticate-options');
		const answer = stolen.get(await options.json());
		const clientData = JSON.parse(
			Buffer.from(answer.response.clientDataJSON, 'base64url').toString()
		);
		clientData.origin = 'http://evil.example';
		answer.response.clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
		const r = await b.ask(
			'/api/auth/passkey/verify-authentication',
			json('POST', { response: answer })
		);
		return { status: r.status, signedIn: b.cookies.signedIn() };
	})();
	check(
		!fromAfar.signedIn && fromAfar.status >= 400,
		'a ceremony from another origin signs nobody in',
		String(fromAfar.status)
	);
	void elsewhere;

	await full.ask(`/api/people/${robinId}`, json('PATCH', { fields: { active: 'false' } }));
	const inactive = await signInWith(browser(), phone);
	check(inactive.status === 403, 'someone made inactive signs in no more', String(inactive.status));
	await full.ask(`/api/people/${robinId}`, json('PATCH', { fields: { active: 'true' } }));

	// A new link from Team asks whether a phone or computer is lost or stolen,
	// and takes no answer for granted.
	const unasked = await full.ask(`/api/people/${robinId}/link`, json('POST', {}));
	check(
		unasked.status === 400 && /lost or stolen/.test((await unasked.json()).errors?.lost ?? ''),
		'a new link is refused until whoever sends it says whether one is lost',
		String(unasked.status)
	);

	// Not lost -- a phone left at home: the link adds a passkey, and ends none.
	await full.ask(`/api/people/${robinId}/link`, json('POST', { lost: false }));
	const kept = linkIn(await arrives(relay, robin, ['a link to make a new passkey', 'still work']));
	check(!!kept, 'a new link from Team says to make a new passkey, and that theirs still work');
	check(await signedIn(r2), 'sending it signs nobody out');
	const tablet = softPasskeys({ origin: base });
	const added2 = await makeWithLink(browser(), tablet, kept?.code ?? '');
	check(added2.status === 200, 'its link makes a new passkey', String(added2.status));
	check((await signInWith(browser(), tablet)).status === 200, 'which signs them in');
	check((await signInWith(browser(), phone)).status === 200, 'and the one left at home still does');
	check(!(await signedIn(r2)), 'using it signs them out everywhere else');

	// Team lists their passkeys, and ends one on its own, for the phone or
	// computer holding it lost: the rest keep working.
	const [{ id: fullId }] = (
		await client.query('select id from "user" where email = $1', [fullEmail])
	).rows;
	const rp = browser();
	await signInWith(rp, tablet);
	const pc = softPasskeys({ origin: base });
	check((await makeSignedIn(rp, pc)).status === 200, 'they add a third, on Your profile');
	const tab = await (await full.ask(`/team/${robinId}/passkeys`)).text();
	check(
		tab.includes('Robin’s phone') && /\b3\s+passkeys\b/.test(tab),
		'their Passkeys tab on Team lists them by name'
	);
	const [{ id: pcId }] = (
		await client.query(
			'select id from passkey where user_id = $1 order by created_at desc limit 1',
			[robinId]
		)
	).rows;
	const [{ id: ownId }] = (
		await client.query('select id from passkey where user_id = $1 limit 1', [fullId])
	).rows;
	const ownOne = await full.ask(`/api/people/${fullId}/passkeys/${ownId}`, { method: 'DELETE' });
	check(ownOne.status === 400, 'nobody ends their own on Team', String(ownOne.status));
	const notTheirs = await full.ask(`/api/people/${robinId}/passkeys/${ownId}`, {
		method: 'DELETE'
	});
	check(notTheirs.status === 404, 'nor someone else’s through theirs', String(notTheirs.status));
	const one = await full.ask(`/api/people/${robinId}/passkeys/${pcId}`, { method: 'DELETE' });
	check(
		one.status === 200 && (await one.json()).left === 2,
		'someone with Full ends one passkey',
		String(one.status)
	);
	check(
		(await signInWith(browser(), pc)).status !== 200 &&
			(await signInWith(browser(), tablet)).status === 200 &&
			(await signInWith(browser(), phone)).status === 200,
		'which signs them in no more, while the others still do'
	);
	check(!(await signedIn(rp)), 'and signs them out where they were');
	check(
		!!(await arrives(relay, robin, ['ended a passkey', 'Your other passkeys still work'])),
		'and they are told, by email, which, and to sign in with another'
	);

	// Lost or stolen: every passkey ends, and they are signed out, as it is
	// sent -- whoever has the phone is out before the link is used.
	const r4 = browser();
	await signInWith(r4, phone);
	await full.ask(`/api/people/${robinId}/link`, json('POST', { lost: true }));
	const after = linkIn(await arrives(relay, robin, ['a link to make a new passkey', 'were ended']));
	check(!!after, 'one sent for a phone lost or stolen says their passkeys were ended');
	check(
		(await signInWith(browser(), phone)).status !== 200 &&
			(await signInWith(browser(), tablet)).status !== 200,
		'sending it ends every passkey they had, there and then'
	);
	check(!(await signedIn(r4)), 'and signs them out where they were');
	const spare = softPasskeys({ origin: base });
	check(
		(await makeWithLink(browser(), spare, after?.code ?? '')).status === 200,
		'its link makes a new passkey'
	);
	check((await signInWith(browser(), spare)).status === 200, 'which signs them in');

	// End their passkeys, on Team, with no link: for one reported lost.
	const r5 = browser();
	await signInWith(r5, spare);
	const ownEnd = await full.ask(`/api/people/${fullId}/passkeys`, { method: 'DELETE' });
	check(ownEnd.status === 400, 'nobody ends their own passkeys on Team', String(ownEnd.status));
	const ended = await full.ask(`/api/people/${robinId}/passkeys`, { method: 'DELETE' });
	check(ended.status === 200, 'someone with Full ends someone’s passkeys', String(ended.status));
	check(
		(await signInWith(browser(), spare)).status !== 200,
		'which sign them in no more, there and then'
	);
	check(!(await signedIn(r5)), 'and signs them out where they were');
	check(
		!!(await arrives(relay, robin, [
			'ended the passkeys you sign in to',
			'to send you a new link'
		])),
		'and they are told, by email, whom to ask for a new link'
	);
	const none = await full.ask(`/api/people/${robinId}/passkeys`, { method: 'DELETE' });
	check(none.status === 409, 'with none left, there are none to end', String(none.status));

	// From the command line, for the one with Full who has lost theirs: invite
	// gives a new link and ends nothing; end ends them.
	const printed = spawnSync(process.execPath, ['scripts/user.mjs', 'invite', robin], {
		encoding: 'utf8'
	});
	const printedCode = /\/link#([A-Za-z0-9_-]{43})/.exec(printed.stdout)?.[1];
	check(!!printedCode, 'the command line gives a new link too', printed.stderr.trim());
	const desk2 = softPasskeys({ origin: base });
	check(
		(await makeWithLink(browser(), desk2, printedCode ?? '')).status === 200,
		'its link makes a new passkey'
	);
	const r6 = browser();
	await signInWith(r6, desk2);
	const again2 = spawnSync(process.execPath, ['scripts/user.mjs', 'invite', robin], {
		encoding: 'utf8'
	});
	check(
		again2.status === 0 && (await signInWith(browser(), desk2)).status === 200,
		'giving another ends none they have'
	);
	const cut = spawnSync(process.execPath, ['scripts/user.mjs', 'end', robin], { encoding: 'utf8' });
	check(cut.status === 0, 'the command line ends their passkeys', cut.stderr.trim());
	check(
		(await signInWith(browser(), desk2)).status !== 200 && !(await signedIn(r6)),
		'which sign them in no more, and they are signed out'
	);
	check(
		!!(await arrives(relay, robin, ['were ended on', 'Contact'])),
		'and they are told, by email'
	);
	const laptop = softPasskeys({ origin: base });
	const laptopCode = /\/link#([A-Za-z0-9_-]{43})/.exec(
		spawnSync(process.execPath, ['scripts/user.mjs', 'invite', robin], { encoding: 'utf8' }).stdout
	)?.[1];
	check(
		(await makeWithLink(browser(), laptop, laptopCode ?? '')).status === 200,
		'and a new link from it lets them make one again'
	);

	// Removing a passkey, on Your profile.
	const r3 = browser();
	await signInWith(r3, laptop);
	const [{ id: laptopId }] = (
		await client.query('select id from passkey where user_id = $1', [robinId])
	).rows;
	const removed = await r3.ask('/profile/passkeys?/remove', {
		method: 'POST',
		body: new URLSearchParams({ id: laptopId }),
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sveltekit-action': 'true' }
	});
	check(
		JSON.parse(await removed.text()).type === 'success',
		'someone with Field removes their passkey'
	);
	check((await signInWith(browser(), laptop)).status !== 200, 'and it signs them in no more');
	check(!!(await arrives(relay, robin, ['a passkey was removed'])), 'and they are told, by email');

	// Someone with Full keeps at least one.
	const desk = softPasskeys({ origin: base });
	const own = await makeSignedIn(full, desk);
	check(own.status === 200, 'someone signed in adds a passkey on Your profile', String(own.status));
	const theirs = (
		await client.query(
			`select p.id, p.created_at from passkey p join "user" u on u.id = p.user_id
			  where u.email = $1 order by p.created_at`,
			[fullEmail]
		)
	).rows;
	const remove = async (/** @type {string} */ id) =>
		JSON.parse(
			await (
				await full.ask('/profile/passkeys?/remove', {
					method: 'POST',
					body: new URLSearchParams({ id }),
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						'x-sveltekit-action': 'true'
					}
				})
			).text()
		);
	const newest = theirs.at(-1)?.id ?? '';
	const first = await remove(newest);
	check(first.type === 'success', 'someone with Full removes a passkey while another remains');
	const lastOne = await remove(theirs[0]?.id ?? '');
	check(
		lastOne.type === 'failure' && lastOne.status === 409,
		'but cannot remove their last',
		`${lastOne.type} ${lastOne.status}`
	);
} finally {
	if (robinId) await client.query('delete from passkey where user_id = $1', [robinId]);
	if (robinId) await client.query('update "user" set active = false where id = $1', [robinId]);
	await client.end();
}

if (failures.length) {
	console.error(`\n${failures.length} of ${passed + failures.length} failed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`\n${passed} checks of passkeys passed.`);
