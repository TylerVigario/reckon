#!/usr/bin/env node
/**
 * Proves a sign-in replaces a password hash made at older parameters.
 *
 *   node scripts/rehash-check.mjs <base-url> <email> <password>
 *
 * WHY. A stored hash records the parameters it was made at, and the sign-in
 * action replaces one made at anything older than today's while the password is
 * in hand -- the one moment it ever is (rehashIfDated in #lib/server/auth.ts).
 * Nothing else exercises that path: every hash the other harnesses meet was
 * made at today's parameters, so the replacement could stop happening and they
 * would all stay green while old hashes sat in the table for ever.
 *
 * So this plants a hash of the same password at older parameters, signs in over
 * HTTP the way a browser does, and reads the row back. It must have signed in
 * -- the old hash still verifies -- and the row must now carry today's
 * parameters.
 *
 * The old hash is made here with node:crypto's argon2, not with whatever the
 * application hashes with, so this checks the application rather than agreeing
 * with it. It writes the standard PHC string any argon2 implementation reads.
 *
 * Needs the database the server uses, and leaves the account signing in with the
 * same password at today's parameters.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

const [, , base, email, password] = process.argv;
if (!base || !email || !password) {
	console.error('usage: node scripts/rehash-check.mjs <base-url> <email> <password>');
	process.exit(2);
}

// In production a TLS proxy stands in front, and the server takes the scheme
// from it. Over plain http this says what that proxy would -- the server is
// started with PROTOCOL_HEADER=x-forwarded-proto to read it.
/** @type {Record<string, string>} */
const PROXY = base.startsWith('http:') ? { 'x-forwarded-proto': 'http' } : {};

// Today's parameters, as src/lib/server/password.ts states them (ARGON, CURRENT_HASH).
// That module imports SvelteKit's own, so a plain node script cannot import it.
const TODAY = '$argon2id$v=19$m=19456,t=2,p=1$';
// Older: a quarter of the memory. Anything that is not today's would do.
const OLD = { memory: 4096, passes: 3, parallelism: 1 };

const b64 = (/** @type {Buffer} */ b) => b.toString('base64').replace(/=+$/, '');
const salt = randomBytes(16);
const tag = argon2Sync('argon2id', { message: password, nonce: salt, tagLength: 32, ...OLD });
const planted = `$argon2id$v=19$m=${OLD.memory},t=${OLD.passes},p=${OLD.parallelism}$${b64(salt)}$${b64(tag)}`;

// The database the server uses, found the way the server finds it: DATABASE_URL,
// or the local socket and PGDATABASE.
const db = process.env.DATABASE_URL
	? new pg.Client({ connectionString: process.env.DATABASE_URL })
	: new pg.Client({
			host: process.env.PGHOST ?? '/var/run/postgresql',
			database: process.env.PGDATABASE ?? 'reckon_dev'
		});
await db.connect();
const failures = [];
try {
	const found = await db.query('select id from "user" where email = $1', [email]);
	if (found.rowCount !== 1) throw new Error(`no user ${email}`);
	const userId = found.rows[0].id;
	const credential = `where user_id = $1 and provider_id = 'credential'`;

	await db.query(`update account set password = $2 ${credential}`, [userId, planted]);

	const r = await fetch(base + '/login', {
		method: 'POST',
		body: new URLSearchParams({ email, password, next: '/' }),
		redirect: 'manual',
		headers: { accept: 'text/html', origin: base, ...PROXY }
	});
	const signedIn = (r.headers.getSetCookie?.() ?? []).some((c) => c.includes('session_token='));
	if (signedIn) console.log('  ✓ a hash at older parameters still signs in');
	else failures.push(`signing in against the planted hash failed (${r.status})`);

	const after = (await db.query(`select password from account ${credential}`, [userId])).rows[0]
		?.password;
	if (after === planted) failures.push('the planted hash is still there: nothing replaced it');
	else if (!after?.startsWith(TODAY))
		failures.push(
			`the hash was replaced, but not at today's parameters: ${after?.split('$').slice(0, 4).join('$')}`
		);
	else console.log("  ✓ the sign-in replaced it with one at today's parameters");
} finally {
	await db.end();
}

if (failures.length) {
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
console.log('\nA sign-in replaces a hash made at older parameters.');
