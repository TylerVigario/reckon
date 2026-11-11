import { and, eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { hash, verify } from '@node-rs/argon2';
import { building } from '$app/env';
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_SECRET_FILE,
	PWNED_PASSWORDS_URL,
	SECURE_COOKIES,
	SITE_URL
} from '$app/env/private';
import { getRequestEvent } from '$app/server';
import type { RequestEvent } from '@sveltejs/kit';
import { db, schema } from './db/index.ts';
import {
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	weakness,
	wordsAbout
} from './password-rules.js';
import { eitherOf } from './secret-file.ts';
import { CLOSED_AUTH_PATHS } from './auth-paths.ts';
import type { Access } from '#lib/access.ts';

/**
 * Sign-in, by Better Auth over the app's own database.
 *
 * There is no sign-up: someone with Full adds people on Team, each emailed a
 * link to choose their own password (#lib/server/links), and the first person
 * is added from the command line (scripts/user.mjs).
 *
 * Its HTTP routes are mounted under /api/auth, as its SvelteKit guide has it
 * (hooks.server.ts), and only where SITE_URL says where reckon is: that is its
 * base URL, never one worked out from a request (GHSA-569q-mpph-wgww). Which of
 * them are served is #lib/server/auth-paths, and none is yet: signing in and
 * out are form actions calling it directly, which its rate limiter and
 * `disabledPaths` do not reach, so every try at a password is recorded, and
 * limited per address and per email, in ./sign-in-limit.
 *
 * BETTER_AUTH_SECRET signs the session cookie, given as it is or as the file
 * BETTER_AUTH_SECRET_FILE names (#lib/server/secret-file). Without one the
 * server does not start, anywhere, `vite dev` included. Whether the cookie is
 * Secure is SECURE_COOKIES, said outright, not inferred from the base URL.
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

const SESSION_DAYS = 30;

/**
 * The secret every session is signed with, and the browsers that have signed in
 * (#lib/server/signed-in-here). Undefined only while building.
 */
export function authSecret(): string | undefined {
	const secret = eitherOf('BETTER_AUTH_SECRET', BETTER_AUTH_SECRET, BETTER_AUTH_SECRET_FILE);
	if (secret === undefined && !building)
		throw new Error(
			'BETTER_AUTH_SECRET must be set, or BETTER_AUTH_SECRET_FILE: it signs every session. ' +
				'`openssl rand -hex 32` makes one; in development, .env holds it (.env.example).'
		);
	return secret;
}

function createAuth() {
	const secret = authSecret();
	return betterAuth({
		secret,
		database: drizzleAdapter(db, { provider: 'pg', schema }),
		// Where reckon is reached, and so what its own routes and origin checks
		// take as this origin (see above).
		baseURL: SITE_URL || undefined,
		// Every route of its own not served (#lib/server/auth-paths).
		disabledPaths: [...CLOSED_AUTH_PATHS],
		// Counted in the database, so a restart forgives nothing, and in every
		// environment, not only where NODE_ENV is production.
		rateLimit: { enabled: true, storage: 'database' },
		// Every message passes through but one: without SITE_URL Better Auth warns
		// that it has no base URL. Its routes are not mounted then, a direct call
		// needs none, and the email sender already says what SITE_URL is missing
		// for (#lib/server/email).
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
			// Where a session's ip_address and the rate limiter's count come from --
			// set by authHeaders() below, and by hooks.server.ts for the mounted
			// routes, to the address adapter-node resolved, so it is never the
			// client's own word.
			ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
			// Its origin and CSRF checks, on. Left unsaid, Better Auth turns both off
			// wherever NODE_ENV is test or TEST is set, and its reset route then
			// redirects anywhere it is asked to.
			disableOriginCheck: false,
			disableCSRFCheck: false
		},
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			// In UTF-16 units, where the rules count characters
			// (#lib/server/password-rules): a character is one unit or two, so
			// these never refuse a password the rules allow, and the rules decide.
			minPasswordLength: MIN_PASSWORD_LENGTH,
			maxPasswordLength: 2 * MAX_PASSWORD_LENGTH,
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
				active: { type: 'boolean', required: false, defaultValue: true, input: false },
				// Set on Team, by someone with Full (#lib/access).
				access: { type: 'string', required: false, defaultValue: 'field', input: false },
				// Set when a password is handed over, cleared when they choose their own.
				temporaryPassword: { type: 'boolean', required: false, defaultValue: false, input: false },
				// Set through /api/people, where each is checked: the zone against
				// Postgres's zones, the locale against Intl's.
				timezone: { type: 'string', required: false, input: false },
				locale: { type: 'string', required: false, input: false },
				hourCycle: { type: 'string', required: false, input: false },
				weekStart: { type: 'number', required: false, input: false }
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
export type SessionUser = {
	id: string;
	name: string;
	email: string;
	/** What they can reach (#lib/access). */
	access: Access;
	/**
	 * Signed in with a password handed to them, before invitations were
	 * emailed: until they choose their own, they reach nothing but the page
	 * where they do.
	 */
	temporaryPassword: boolean;
	/** Their own zone, or null until their browser has set it. */
	timezone: string | null;
	/** Their own locale, clock and first day of the week; null follows the business's. */
	locale: string | null;
	hourCycle: 'h12' | 'h23' | null;
	weekStart: number | null;
};

/**
 * What is wrong with a password being chosen for this person
 * (#lib/server/password-rules), or null: held against their own names and the
 * business's, and asked of Pwned Passwords where PWNED_PASSWORDS_URL says.
 */
export async function weaknessOf(password: string, person: { name: string; email: string }) {
	const [business] = await db
		.select({
			tradingName: schema.operator.tradingName,
			shortName: schema.operator.shortName,
			email: schema.operator.email
		})
		.from(schema.operator)
		.limit(1);
	return weakness(password, { about: wordsAbout(person, business), pwned: PWNED_PASSWORDS_URL });
}

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
