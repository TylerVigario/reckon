import { and, eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { hash, verify } from '@node-rs/argon2';
import { BETTER_AUTH_SECRET, SECURE_COOKIES } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import type { RequestEvent } from '@sveltejs/kit';
import { db, schema } from './db/index.ts';

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

/**
 * argon2id at the OWASP minimum. Better Auth's own default is scrypt below
 * OWASP's scrypt minimum; its password option is how a different algorithm is
 * given. The hash records its own parameters, so a stored hash made at older
 * ones is replaced at the next sign-in (see rehashIfDated).
 */
// 2 is Argon2id. The enum is a const enum, which verbatimModuleSyntax cannot
// import; the number is what it compiles to either way.
export const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (password: string) => hash(password, ARGON);

/** The header every hash made at today's parameters starts with. */
export const CURRENT_HASH = `$argon2id$v=19$m=${ARGON.memoryCost},t=${ARGON.timeCost},p=${ARGON.parallelism}$`;

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
				hash: hashPassword,
				verify: ({ hash: stored, password }) => verify(stored, password).catch(() => false)
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
