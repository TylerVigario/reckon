import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { passkey } from '@better-auth/passkey';
import { building } from '$app/env';
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_SECRET_FILE,
	SECURE_COOKIES,
	SITE_URL
} from '$app/env/private';
import { getRequestEvent } from '$app/server';
import type { RequestEvent } from '@sveltejs/kit';
import { db, schema } from './db/index.ts';
import { eitherOf } from './secret-file.ts';
import { CLOSED_AUTH_PATHS } from './auth-paths.ts';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import {
	beforeKeeping,
	beforeSigningIn,
	forTheLink,
	mayOpenSession,
	sessionOpened,
	signInRefused
} from './passkeys.ts';
import type { Access } from '#lib/access.ts';
import { log } from './log.ts';
import { SESSION_UNUSED_DAYS } from '#lib/offline-copy.ts';

/**
 * Sign-in, by Better Auth over the app's own database, with passkeys alone:
 * there are no passwords (#lib/server/passkeys).
 *
 * There is no sign-up: someone with Full adds people on Team, and the first
 * person is added from the command line (scripts/user.mjs); either way they
 * are given an invitation link to make their passkey with (#lib/server/links).
 * Someone who has lost theirs is given a new link the same way.
 *
 * Its HTTP routes are mounted under /api/auth, as its SvelteKit guide has it
 * (hooks.server.ts), and only where SITE_URL says where reckon is: that is its
 * base URL, never one worked out from a request (GHSA-569q-mpph-wgww), and the
 * site each passkey is made for. Which of them are served is
 * #lib/server/auth-paths: a passkey's ceremonies. Signing out is a form action
 * calling it directly.
 *
 * BETTER_AUTH_SECRET signs the session cookie, given as it is or as the file
 * BETTER_AUTH_SECRET_FILE names (#lib/server/secret-file). Without one the
 * server does not start, anywhere, `vite dev` included. Whether the cookie is
 * Secure is SECURE_COOKIES, said outright, not inferred from the base URL.
 */

/*
 * HOW LONG SOMEONE STAYS SIGNED IN: SESSION_UNUSED_DAYS without use, each use
 * carrying it on -- Better Auth's own expiry, slid forward at the first use in
 * each hour (#lib/offline-copy, where a phone's copies lapse with it). The
 * checks that matter are where the harm is instead: a lost phone's passkeys
 * ended on Team, and signing in again is a touch, where asking often costs
 * more than it guards (Microsoft: "Regular reauthentication prompts are bad
 * for user productivity and can make users more vulnerable to attacks"). Over
 * 20 hours, so WCAG 2.2.1 asks no warning before it.
 *
 * An overall limit besides, however much a session is used -- NIST SP
 * 800-63B-4 §2.2.3: one "SHALL be established"; ASVS 5.0 7.3.2 -- is Better
 * Auth's to give, and it has none yet (better-auth/better-auth#10405).
 */

/** The secret every session is signed with. Undefined only while building. */
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
				log[level]({ 'code.namespace': 'better-auth', ...(args.length ? { args } : {}) }, message);
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
		// No passwords: a passkey is the only way in.
		emailAndPassword: { enabled: false },
		session: {
			expiresIn: SESSION_UNUSED_DAYS * 86400,
			// Slid forward at the first use in each hour: two weeks from the last
			// use, give or take that hour, for one row written an hour at most.
			updateAge: 3600
		},
		user: {
			// Set when a person is added or their role changes, never by the
			// person signing in.
			additionalFields: {
				roleId: { type: 'string', required: false, input: false },
				active: { type: 'boolean', required: false, defaultValue: true, input: false },
				// Set on Team, by someone with Full (#lib/access).
				access: { type: 'string', required: false, defaultValue: 'field', input: false },
				// Set through /api/people, where each is checked: the zone against
				// Postgres's zones, the locale against Intl's.
				timezone: { type: 'string', required: false, input: false },
				locale: { type: 'string', required: false, input: false },
				hourCycle: { type: 'string', required: false, input: false },
				weekStart: { type: 'number', required: false, input: false }
			}
		},
		// Every session opens for someone still active, and each that opens is a
		// sign-in in the security log (#lib/server/passkeys).
		databaseHooks: {
			session: {
				create: {
					before: (session) => mayOpenSession(session.userId),
					after: (session, ctx) => sessionOpened(session.userId, ctx?.path)
				}
			}
		},
		// And each passkey sign-in refused, by the plugin or by reckon, is one too,
		// with whose passkey it was where that is known.
		hooks: {
			after: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== '/passkey/verify-authentication') return;
				const returned = ctx.context.returned;
				if (!isAPIError(returned)) return;
				const body = returned.body as { code?: string; message?: string } | undefined;
				await signInRefused(
					(ctx.body as { response?: { id?: string } } | undefined)?.response?.id,
					body?.code,
					body?.message ?? returned.message
				);
			})
		},
		plugins: [
			// Passkeys, for this site alone: its host name is what each is made for,
			// and only a ceremony on its own origin is taken. Discoverable, so one
			// signs in without an address typed first, and asked to check who is
			// holding it, which #lib/server/passkeys then insists on.
			...(SITE_URL
				? [
						passkey({
							rpID: new URL(SITE_URL).hostname,
							rpName: 'reckon',
							origin: SITE_URL,
							authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
							registration: {
								requireSession: false,
								resolveUser: ({ ctx, context }) => forTheLink({ ctx, context: context ?? null }),
								afterVerification: async ({ ctx, verification, user, context }) =>
									beforeKeeping({
										request: ctx.request,
										userId: user.id,
										userVerified: verification.registrationInfo?.userVerified === true,
										aaguid: verification.registrationInfo?.aaguid,
										context: context ?? null
									})
							},
							authentication: {
								afterVerification: async ({ ctx, verification, clientData }) =>
									beforeSigningIn({
										request: ctx.request,
										credentialId: clientData.id,
										userVerified: verification.authenticationInfo.userVerified
									})
							}
						})
					]
				: []),
			// Lets a form action's sign-in and sign-out set and clear the cookie. Last,
			// as Better Auth asks.
			sveltekitCookies(getRequestEvent)
		]
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
	/** Their own zone, or null until their browser has set it. */
	timezone: string | null;
	/** Their own locale, clock and first day of the week; null follows the business's. */
	locale: string | null;
	hourCycle: 'h12' | 'h23' | null;
	weekStart: number | null;
};

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
