import { and, eq, isNull, sql } from 'drizzle-orm';
import { PWNED_PASSWORDS_URL } from '$app/env/private';
import { db } from './db/index.ts';
import { session, signInTry, user } from './db/schema/index.ts';
import { tell } from './email.ts';
import { cannotSend, issue } from './links.ts';
import { passwordBreached, passwordBreachedUnconfirmed } from './notices.js';
import { breached } from './password-rules.js';
import type { Try } from './sign-in-limit.ts';

/**
 * A PASSWORD SEEN IN A BREACH, found as someone signs in with it. Every rule is
 * held to when a password is chosen (#lib/server/password-rules); what can
 * change after is Pwned Passwords coming to hold it, from a breach somewhere
 * else, and a sign-in is the one moment reckon has it in hand to ask again.
 *
 * One it has seen is evidence it is compromised, so it stops there (NIST SP
 * 800-63B-4 §3.1.1.2, "verifiers SHALL force a change if there is evidence
 * that the authenticator has been compromised"; §4.3, "suspend, invalidate, or
 * destroy compromised authenticators ... promptly following compromise
 * detection"): no session opens, every one they had ends, and whoever typed it
 * cannot choose the next. With no other authenticator, replacing it is
 * recovery, by an issued recovery code (§4.2.2.1): the hour's link forgot
 * password sends (#lib/server/recovery), emailed only to an address proven
 * theirs (§4.2.1.2), and saying why. Using it chooses a new password and tells
 * them so, as recovery must (§4.2.3).
 *
 * The page tells whoever typed it that it was right, as Clerk's, Okta's and
 * Auth0's do: it stops in that moment, so knowing is worth nothing.
 *
 * Where Pwned Passwords cannot say, the sign-in goes ahead and the log says so:
 * it is asked again at the next one.
 */

/** Whether Pwned Passwords has seen this password, or null where it could not say. */
export const seenInABreach = (password: string) => breached(password, PWNED_PASSWORDS_URL);

/**
 * What became of a password found breached as its person signed in: a link to
 * choose another emailed them; or none, since their address is not confirmed
 * theirs, or reckon has no email to send by.
 */
export type Stopped = 'sent' | 'unconfirmed' | 'unsendable';

/**
 * Stops `userId`'s password, found breached on the sign-in `tried`, ends every
 * session they have -- the one that sign-in opened among them -- and emails
 * them, once, however many tries find it at once.
 */
export async function stopBreached(tried: Try, userId: string): Promise<Stopped> {
	return db.transaction(async (tx) => {
		await tx.update(signInTry).set({ outcome: 'breached' }).where(eq(signInTry.id, tried.id));
		const [stopped] = await tx
			.update(user)
			.set({ passwordStoppedAt: sql`now()`, updatedAt: sql`${user.updatedAt}` })
			.where(and(eq(user.id, userId), isNull(user.passwordStoppedAt)))
			.returning({ id: user.id });
		await tx.delete(session).where(eq(session.userId, userId));
		const [person] = await tx
			.select({ confirmed: user.emailVerified })
			.from(user)
			.where(eq(user.id, userId));
		const told: Stopped = cannotSend() ? 'unsendable' : person?.confirmed ? 'sent' : 'unconfirmed';
		// Told by whichever try stopped it: another found it first, and told them.
		if (!stopped || told === 'unsendable') return told;

		const at = new Date();
		if (told === 'unconfirmed') {
			await tell(tx, userId, (them, business) =>
				passwordBreachedUnconfirmed(them, business, { at })
			);
			return told;
		}
		const sent = await issue(tx, userId, 'recover', null);
		await tell(
			tx,
			userId,
			(them, business) => passwordBreached(them, business, { at, ...sent }),
			sent.until
		);
		return told;
	});
}
