import { and, eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { BETTER_AUTH_SECRET, SECURE_COOKIES } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import type { RequestEvent } from '@sveltejs/kit';
import { db, schema } from './db/index.ts';
import { CURRENT_HASH, hashPassword, verifyPassword } from './password.ts';

/**
 * Sign-in, by Better Auth over the app's own database.
 *
 * There is no sign-up: an operator's people are added from the command line
 * (scripts/user.mjs). Better Auth's HTTP routes are not mounted -- sign-in and
 * sign-out are form actions calling it directly -- so its own rate limiter
 * never runs, and wrong passwords are limited per address in ./sign-in-limit.
 *
 * BETTER_AUTH_SECRET signs the session cookie; src/env.ts refuses to start
 * without one anywhere but `vite dev`.
 *
 * Better Auth is given no base URL, because in this application it has none:
 * its routes are not mounted, it is never called over HTTP, and its origin
 * check returns early for a direct call. The one thing a base URL would have
 * decided -- whether the cookie is Secure -- is SECURE_COOKIES, said outright.
 */

export const MIN_PASSWORD_LENGTH = 12;
const SESSION_DAYS = 30;

function createAuth() {
	return betterAuth({
		secret: BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'pg', schema }),
		// Every message passes through but one: at start Better Auth warns that it
		// has no base URL, which is true and harmless here (see above), and would
		// send whoever reads the log to set one.
		logger: {
			log: (level, message, ...args: unknown[]) => {
				if (level === 'warn' && message.includes('Base URL is not set')) return;
				console[level]('[Better Auth]', message, ...args);
			}
		},
		advanced: {
			cookiePrefix: 'reckon',
			useSecureCookies: SECURE_COOKIES,
			// The tables give every id a database default (uuidv7); this leaves it to them.
			database: { generateId: false },
			// Where a session's ip_address comes from -- set by authHeaders() below,
			// so it is never the client's own word.
			ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }
		},
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			password: {
				// argon2id at the OWASP minimum, in place of Better Auth's own scrypt,
				// which is below OWASP's minimum for scrypt (./password.ts).
				hash: hashPassword,
				verify: ({ hash: stored, password }) => verifyPassword(stored, password)
			}
		},
		session: {
			expiresIn: SESSION_DAYS * 86400,
			// Slid forward once past halfway, so daily use never expires mid-job
			// while an abandoned browser still ages out.
			updateAge: (SESSION_DAYS / 2) * 86400
		},
		user: {
			// Set when a person is added or their role changes, never by the
			// person signing in.
			additionalFields: {
				roleId: { type: 'string', required: false, input: false },
				active: { type: 'boolean', required: false, defaultValue: true, input: false }
			}
		},
		// Lets a form action's sign-in and sign-out set and clear the cookie.
		plugins: [sveltekitCookies(getRequestEvent)]
	});
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * Made on first use, not at import. The build imports server modules to
 * analyse them, with no secret in its environment, and that is not a reason to
 * fail the build.
 */
export function getAuth() {
	return (instance ??= createAuth());
}

/** Who is signed in, as every page sees it. */
export type SessionUser = { id: string; name: string; email: string };

/**
 * The headers to hand Better Auth for this request: the client's own, with the
 * address SvelteKit resolved in place of any X-Forwarded-For the client sent.
 * Which proxy to believe is adapter-node's setting (ADDRESS_HEADER, XFF_DEPTH),
 * so it is decided in one place.
 */
export function authHeaders(event: RequestEvent): Headers {
	const headers = new Headers(event.request.headers);
	headers.set('x-forwarded-for', event.getClientAddress());
	return headers;
}

/**
 * After a successful sign-in, while the password is in hand -- the one moment it
 * ever is -- a hash made at older parameters is replaced with one at today's.
 */
export async function rehashIfDated(userId: string, password: string): Promise<void> {
	const { account } = schema;
	const [row] = await db
		.select({ id: account.id, password: account.password })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
	if (row?.password && !row.password.startsWith(CURRENT_HASH))
		await db
			.update(account)
			.set({ password: await hashPassword(password) })
			.where(eq(account.id, row.id));
}
