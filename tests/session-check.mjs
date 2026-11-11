#!/usr/bin/env node
/**
 * Proves how long someone stays signed in (#lib/server/auth): until two weeks
 * without use, each use carrying it on, and its cookie with it. Time is not
 * waited for: a session's own dates are moved back in the database the server
 * uses, as two weeks passing would leave them.
 *
 *   node tests/session-check.mjs <base-url> <email>
 *
 * The person must have a passkey tests/passkeys.mjs made. Only the sessions
 * this opens are touched.
 */
// First, so .env is read before anything reads what it sets.
import { database } from '../scripts/env.mjs';
import pg from 'pg';
import { signIn } from './passkeys.mjs';

const [, , base, email] = process.argv;
if (!base || !email) {
	console.error('usage: node tests/session-check.mjs <base-url> <email>');
	process.exit(2);
}

/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};
const DAY = 86_400_000;
const WEEKS_2 = 14 * DAY;

let passed = 0;
/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ what, detail = '') => {
	if (ok) passed++;
	else failures.push(detail ? `${what}: ${detail}` : what);
	console.log(`  ${ok ? '✓' : '✗'} ${what}`);
};

const client = new pg.Client(database());
await client.connect();

/** A session cookie's own token: what is before the signature, as the row keeps it. */
const tokenOf = (/** @type {string} */ value) => decodeURIComponent(value).split('.')[0];

/** Home, asked with a session cookie: its status, and the session cookie it sets, if any. */
async function home(/** @type {string} */ cookie) {
	const r = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie, ...PROXY } });
	const set = r.headers.getSetCookie().find((c) => /session_token=/.test(c)) ?? null;
	return { status: r.status, where: r.headers.get('location'), set };
}

const row = async (/** @type {string} */ token) =>
	(
		await client.query(
			'select id, expires_at as "expiresAt", created_at as "createdAt" from session where token = $1',
			[token]
		)
	).rows[0] ?? null;

/** Moves a session's dates as time passing would: its expiry, when it was made, and last slid. */
async function age(
	/** @type {string} */ token,
	/** @type {{ expires: number, created?: number }} */ by
) {
	await client.query(
		`update session set expires_at = now() + make_interval(secs => $2::float8 / 1000),
		        updated_at = now() + make_interval(secs => ($2::float8 - ${WEEKS_2}) / 1000),
		        created_at = coalesce(now() - make_interval(secs => $3::float8 / 1000), created_at)
		  where token = $1`,
		[token, by.expires, by.created ?? null]
	);
}

const tokens = [];
try {
	// Two weeks without use.
	const a = await signIn(base, email);
	const ta = tokenOf(a.value);
	tokens.push(ta);
	const fresh = await row(ta);
	const left = fresh ? new Date(fresh.expiresAt).getTime() - Date.now() : 0;
	check(
		Math.abs(left - WEEKS_2) < 60_000,
		'a new session lasts two weeks without use',
		`${(left / DAY).toFixed(2)} days`
	);
	check((await home(a.cookie)).status === 200, 'and signs them in');

	// Used, after a day and a bit: it lasts two weeks from now again, and the
	// browser is told so, or its cookie would lapse two weeks after signing in.
	await age(ta, { expires: WEEKS_2 - DAY - 2 * 3_600_000 });
	const used = await home(a.cookie);
	const slid = await row(ta);
	const now = slid ? new Date(slid.expiresAt).getTime() - Date.now() : 0;
	check(
		used.status === 200 && Math.abs(now - WEEKS_2) < 60_000,
		'using it carries it on, two weeks from then',
		`${used.status}, ${(now / DAY).toFixed(2)} days`
	);
	const maxAge = Number(/max-age=(\d+)/i.exec(used.set ?? '')?.[1] ?? 0);
	check(
		Math.abs(maxAge - WEEKS_2 / 1000) < 60,
		'and its cookie with it',
		used.set ?? 'no cookie set'
	);

	// Used again within the hour: nothing is written.
	const before = (await row(ta))?.expiresAt;
	await home(a.cookie);
	const after = (await row(ta))?.expiresAt;
	check(
		new Date(before).getTime() === new Date(after).getTime(),
		'used again within the hour, it is not written again'
	);

	// Two weeks unused: signed out.
	await age(ta, { expires: -60_000, created: 15 * DAY });
	const lapsed = await home(a.cookie);
	check(
		lapsed.status >= 300 && lapsed.status < 400 && /\/login/.test(lapsed.where ?? ''),
		'two weeks unused, it signs nobody in',
		`${lapsed.status} ${lapsed.where}`
	);
} finally {
	await client.query('delete from session where token = any($1)', [tokens]);
	await client.end();
}

if (failures.length) {
	console.error(`\n${failures.length} of ${passed + failures.length} failed:`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`\n${passed} checks of how long a session lasts passed.`);
