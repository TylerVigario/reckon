import { getAuthenticatorName } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { browserName } from '#lib/browser-name.ts';
import { db, type Tx } from './db/index.ts';
import { passkey, session, user } from './db/schema/index.ts';
import { tell } from './email.ts';
import { endPasskeyLinks, usableById, used } from './links.ts';
import { passkeyAdded } from './notices.js';

/**
 * WHAT RECKON ASKS OF A PASSKEY, beside what Better Auth's passkey plugin does
 * itself (#lib/server/auth): whom one may be made for, that it checked who is
 * holding it, what ends them, and who is told.
 *
 * A passkey is made in one of two places. Signed in, on Your profile, for the
 * person signed in. Or with a link reckon emailed -- an invitation, or a new
 * link sent on Team -- by someone not signed in at all: the link's page looks
 * the code up and asks the plugin for the ceremony itself, server to server,
 * naming the link by its id (#routes/link). Nothing over HTTP can name one, so
 * no code or token is ever in an address (OWASP ASVS 5.0 14.2.1).
 *
 * Every passkey must check who is holding it -- a fingerprint, a face, a PIN
 * or a screen lock -- and say so in its user-verified flag. NIST SP 800-63B-4
 * B.3: verifiers "SHALL indicate that UV is preferred and SHALL inspect
 * responses to confirm the value of the UV flag", and without it a passkey is
 * one factor. One that did not is refused, made or used: a sign-in by passkey
 * alone is then two factors, AAL2, which an account holding pay needs (NIST SP
 * 800-63A-4 §5.2).
 */

/** Said when a passkey did not check who was holding it. */
export const NOT_VERIFIED =
	'That passkey didn’t check it was you, with a fingerprint, face or screen lock. Turn one on for it, or use another.';

/** Said when the link a passkey is being made with no longer works. */
export const LINK_GONE = 'That link no longer works. Ask whoever sent it to send another.';

/**
 * What a passkey is called: its name -- given when it was made, or since --
 * or else its manager's, where it says; or null, where it has neither.
 */
export const passkeyName = (p: { name: string | null; aaguid: string | null }) =>
	p.name?.trim() || getAuthenticatorName(p.aaguid ?? undefined) || null;

/** What a passkey is listed as: its name, or "A passkey". */
export const passkeyLabel = (p: { name: string | null; aaguid: string | null }) =>
	passkeyName(p) ?? 'A passkey';

/**
 * Whom a passkey made with a link is for: the person the link names, while it
 * can be used. Only reckon's own link page names one, calling the plugin
 * directly; the same route asked over HTTP has a request, and is refused.
 */
export async function forTheLink({
	ctx,
	context
}: {
	ctx: { request?: Request };
	context: string | null;
}) {
	if (ctx.request || !context)
		throw new APIError('UNAUTHORIZED', {
			message: 'Sign in to add a passkey, or use the link reckon emailed you.'
		});
	const link = await db.transaction((tx) => usableById(tx, context));
	if (!link) throw new APIError('UNAUTHORIZED', { message: LINK_GONE });
	return { id: link.userId, name: link.email, displayName: link.name };
}

/**
 * Ends every passkey someone has, and signs them out everywhere, there and
 * then, for a phone or computer of theirs that is lost or stolen: on Team, by
 * someone with Full, as its own action or as a new link is sent, or from the
 * command line (scripts/user.mjs end does the same). NIST SP 800-63B-4 §4.3
 * takes "a lost authenticator" to have been "stolen or compromised", and the
 * CSP "SHALL suspend, invalidate, or destroy compromised authenticators"
 * promptly; their sessions go with them, since "an attacker may still have an
 * active session" (OWASP's Forgot Password Cheat Sheet).
 *
 * Only when someone says so. A new link alone ends none: someone who can't
 * sign in may have left their phone at home, not lost it, and recovery is
 * binding a new authenticator (§4.2), not invalidating the old.
 *
 * OWASP's "do not make a change to the account until a valid token is
 * presented" is for a reset anyone can ask for, where it would let a stranger
 * lock someone out. Only someone with Full ends someone's passkeys.
 *
 * How many passkeys there were.
 */
export async function endPasskeys(tx: Tx, userId: string): Promise<number> {
	const ended = await tx
		.delete(passkey)
		.where(eq(passkey.userId, userId))
		.returning({ id: passkey.id });
	await tx.delete(session).where(eq(session.userId, userId));
	return ended.length;
}

/**
 * A passkey just made, before it is kept: refused unless it checked who was
 * holding it. Made with a link, the link is used then, and so ends: the
 * address it went to is proven theirs, any other link to set up a way in
 * stops, and they are signed out everywhere, to be signed in with the new
 * passkey -- OWASP's Passkey Security Cheat Sheet: "After recovery, rotate
 * sessions". The passkeys they had are kept: a new link adds one, and ending
 * them is endPasskeys'.
 *
 * Either way they are told, at their address (NIST SP 800-63B-4 §4.1.2.1),
 * and it is named, for Your profile: after its passkey manager, where it says
 * which, or else the browser and system it was made on, "Safari on iPhone"
 * (web.dev, Help users manage passkeys effectively: "If no matching passkey
 * provider is found, naming it after the device information based on the
 * user agent string should be fine"). Apple's never say: they send an
 * all-zero AAGUID when no attestation is asked for, as none is here. The
 * plugin keeps the name returned, and they rename it as they like.
 */
export async function beforeKeeping({
	request,
	userId,
	userVerified,
	aaguid,
	context
}: {
	request?: Request;
	userId: string;
	userVerified: boolean;
	aaguid: string | undefined;
	context: string | null;
}): Promise<{ name?: string }> {
	if (!userVerified) throw new APIError('FORBIDDEN', { message: NOT_VERIFIED });
	const added = {
		name: passkeyName({ name: null, aaguid: aaguid ?? null }),
		at: new Date(),
		from: browserName(request?.headers.get('user-agent'))
	};
	const named = { name: added.name ?? added.from ?? undefined };
	if (!context) {
		await tell(db, userId, (them, business) => passkeyAdded(them, business, added));
		return named;
	}
	const kept = await db.transaction(async (tx) => {
		const link = await usableById(tx, context);
		if (!link || link.userId !== userId) return false;
		await used(tx, link);
		await endPasskeyLinks(tx, userId);
		await tx.delete(session).where(eq(session.userId, userId));
		await tell(tx, userId, (them, business) => passkeyAdded(them, business, added));
		return true;
	});
	if (!kept) throw new APIError('UNAUTHORIZED', { message: LINK_GONE });
	// The plugin signs them in with it, there and then.
	await signedInNow(userId);
	return named;
}

/**
 * A passkey just used to sign in, before the session opens: refused unless it
 * checked who was holding it, and noted as used now and from which browser
 * and system, for Your profile -- and its person as signed in now, for Team.
 */
export async function beforeSigningIn({
	request,
	credentialId,
	userVerified
}: {
	request?: Request;
	credentialId: string;
	userVerified: boolean;
}) {
	if (!userVerified) throw new APIError('FORBIDDEN', { message: NOT_VERIFIED });
	const [used] = await db
		.update(passkey)
		.set({
			lastUsedAt: new Date(),
			lastUsedFrom: browserName(request?.headers.get('user-agent'))
		})
		.where(eq(passkey.credentialID, credentialId))
		.returning({ userId: passkey.userId });
	if (used) await signedInNow(used.userId);
}

/** What Team says as someone's last sign-in. Not a change to them, so updated_at stays. */
const signedInNow = (userId: string) =>
	db
		.update(user)
		.set({ lastSignedInAt: sql`now()`, updatedAt: sql`${user.updatedAt}` })
		.where(eq(user.id, userId));

/**
 * Whether a session opening is for someone still active: one made inactive on
 * Team signs in no more.
 */
export async function mayOpenSession(userId: string) {
	const [person] = await db.select({ active: user.active }).from(user).where(eq(user.id, userId));
	if (person?.active !== true)
		throw new APIError('FORBIDDEN', { message: 'That passkey no longer signs anyone in.' });
}
