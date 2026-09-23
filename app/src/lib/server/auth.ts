import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '$lib/server/db';

/**
 * Signing in.
 *
 * Sessions are rows rather than signed tokens. One server, one database, and
 * every page reads it anyway -- so a stateless token would save no round trip
 * and would cost the thing that matters: a session you can revoke now. There is
 * also no signing key to rotate or leak.
 *
 * The cookie carries 256 random bits and means nothing on its own. Only its
 * SHA-256 is stored, so a dump of the session table does not let anyone in --
 * the same reason a password is stored as a hash. SHA-256 is right here and
 * argon2 is not: the token is already full-entropy random, so there is nothing
 * to brute force and no reason to make lookups slow.
 */

export const COOKIE = 'reckon_session';
const LIFETIME_DAYS = 30;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

/** argon2id at the OWASP minimum. The hash records its own parameters, so
 *  raising them later re-hashes on next sign-in rather than locking anyone out. */
// 2 is Argon2id. The enum is a const enum, which verbatimModuleSyntax cannot
// import; the number is what it compiles to either way.
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, ARGON);

// A hash of "no user by that email", so a missing account costs the same time
// as a wrong password. Otherwise the response time says which accounts exist.
const DECOY =
	'$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export type SessionUser = { id: string; name: string; email: string };

/**
 * Checks an email and password.
 *
 * Returns the user, or why not. The caller shows one message for every failure:
 * saying which half was wrong is an account-enumeration oracle.
 */
export async function authenticate(
	email: string,
	password: string
): Promise<{ user?: SessionUser; lockedFor?: number }> {
	const [row] = await sql<
		{
			id: string;
			name: string;
			email: string;
			credential: string;
			active: boolean;
			failed_attempts: number;
			locked_until: Date | null;
		}[]
	>`
		select id, name, email, credential, active, failed_attempts, locked_until
		  from app_user where lower(email) = lower(${email})`;

	if (!row || !row.active) {
		await verify(DECOY, password).catch(() => false);
		return {};
	}

	if (row.locked_until && new Date(row.locked_until) > new Date()) {
		const mins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60_000);
		return { lockedFor: mins };
	}

	const ok = await verify(row.credential, password).catch(() => false);
	if (!ok) {
		const n = row.failed_attempts + 1;
		await sql`
			update app_user
			   set failed_attempts = ${n},
			       locked_until = ${
								n >= LOCK_AFTER ? sql`now() + ${LOCK_MINUTES + ' minutes'}::interval` : sql`null`
							}
			 where id = ${row.id}`;
		return {};
	}

	await sql`
		update app_user set failed_attempts = 0, locked_until = null, last_seen_at = now()
		 where id = ${row.id}`;
	return { user: { id: row.id, name: row.name, email: row.email } };
}

/** A new session. Always a new one: reusing a pre-login id is session fixation. */
export async function open(userId: string, userAgent: string | null) {
	const token = randomBytes(32).toString('base64url');
	await sql`
		insert into session (token_hash, user_id, expires_at, user_agent)
		values (${digest(token)}, ${userId},
		        now() + ${LIFETIME_DAYS + ' days'}::interval, ${userAgent})`;
	return { token, maxAge: LIFETIME_DAYS * 86400 };
}

/** The user this cookie belongs to, or null. Expired rows are cleared as met. */
export async function resolve(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const [row] = await sql<
		{
			token_hash: string;
			expires_at: Date;
			id: string;
			name: string;
			email: string;
			active: boolean;
		}[]
	>`
		select s.token_hash, s.expires_at, u.id, u.name, u.email, u.active
		  from session s join app_user u on u.id = s.user_id
		 where s.token_hash = ${digest(token)}`;

	if (!row) return null;
	if (!row.active || new Date(row.expires_at) <= new Date()) {
		await sql`delete from session where token_hash = ${row.token_hash}`;
		return null;
	}

	// Slide the expiry once past halfway, so daily use never expires mid-job
	// while an abandoned browser still ages out.
	const left = new Date(row.expires_at).getTime() - Date.now();
	if (left < (LIFETIME_DAYS * 86400_000) / 2) {
		await sql`
			update session set expires_at = now() + ${LIFETIME_DAYS + ' days'}::interval,
			                   last_used = now()
			 where token_hash = ${row.token_hash}`;
	} else {
		await sql`update session set last_used = now() where token_hash = ${row.token_hash}`;
	}

	return { id: row.id, name: row.name, email: row.email };
}

export async function close(token: string | undefined) {
	if (token) await sql`delete from session where token_hash = ${digest(token)}`;
}

/** Every session for one person: what "sign out everywhere" and a password
 *  change both need. */
export const closeAll = (userId: string) => sql`delete from session where user_id = ${userId}`;
