import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { SECURE_COOKIES } from '$app/env/private';
import { authSecret } from './auth.ts';

/**
 * WHO HAS SIGNED IN ON THIS BROWSER. A browser that has signed in as someone
 * keeps a count of its own of the tries at their password
 * (#lib/server/sign-in-limit), so a stranger's tries never make it wait. These
 * are the device cookies of OWASP's "Slow Down Online Guessing Attacks with
 * Device Cookies"; Okta spares a known device the same way, and Microsoft
 * Entra a familiar location.
 *
 * A cookie holds an entry for each person who has signed in on the browser, the
 * newest first: a nonce, and an HMAC of it and their email. It names nobody. An
 * entry is checked against the email typed at sign-in, so only a browser that
 * signed in with that email holds one that matches, and the nonce says which
 * browser it is. It outlives signing out, which is the point of it, and is sent
 * only to the sign-in page.
 */

/** The cookie the entries are kept in. */
export const SIGNED_IN_HERE = 'signed_in_here';
/** As long as a browser keeps a cookie: RFC 6265bis caps an expiry at 400 days. */
const KEPT_S = 60 * 60 * 24 * 400;
/** Entries kept at most; past it the oldest goes. */
const ENTRIES = 10;
const ENTRY = /^[\w-]{22}\.[\w-]{43}$/;

/** Its own key, drawn from the session secret, so nothing else it signs can stand for an entry. */
let key: Buffer | undefined;
const keyOf = () =>
	(key ??= createHmac('sha256', authSecret() ?? '')
		.update('reckon: signed in here')
		.digest());

const signed = (email: string, nonce: string) =>
	createHmac('sha256', keyOf()).update(`${email}\n${nonce}`).digest('base64url');

const entriesIn = (cookie: string | undefined) =>
	(cookie ?? '').split('~').filter((entry) => ENTRY.test(entry));

/** The nonce of this cookie's entry for `email`, or null when it holds none. */
function nonceFor(cookie: string | undefined, email: string): string | null {
	for (const entry of entriesIn(cookie)) {
		const [nonce, given] = entry.split('.');
		if (timingSafeEqual(Buffer.from(given), Buffer.from(signed(email, nonce)))) return nonce;
	}
	return null;
}

/** Which browser this is to the sign-in limit, if it has signed in as `email`; else null. */
export function browserSignedInAs(cookies: Cookies, email: string): string | null {
	return nonceFor(cookies.get(SIGNED_IN_HERE), email);
}

/** Signed in as `email`: the browser has a new entry for them, ahead of the others. */
export function signedInHere(cookies: Cookies, email: string): void {
	const kept = cookies.get(SIGNED_IN_HERE);
	const mine = nonceFor(kept, email);
	const others = entriesIn(kept).filter((entry) => !mine || !entry.startsWith(`${mine}.`));
	const nonce = randomBytes(16).toString('base64url');
	cookies.set(
		SIGNED_IN_HERE,
		[`${nonce}.${signed(email, nonce)}`, ...others].slice(0, ENTRIES).join('~'),
		{
			path: '/login',
			httpOnly: true,
			sameSite: 'strict',
			secure: SECURE_COOKIES,
			maxAge: KEPT_S
		}
	);
}
