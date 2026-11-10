import { and, count, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { recoveryAsk, user } from './db/schema/index.ts';
import { tell } from './email.ts';
import { cannotSend, issue } from './links.ts';
import { passwordRecovery, passwordRecoveryUnconfirmed } from './notices.js';
import { emailKey, placeOf } from './sign-in-limit.ts';

/**
 * FORGOT PASSWORD: whoever forgot theirs asks, on the sign-in page, for a link
 * to choose a new one (routes/forgot-password). NIST SP 800-63B-4 §4.2 recovers
 * an account whose only authenticator is a password by an issued recovery code,
 * and §4.2.1.2 sends one only to an address confirmed its holder's.
 *
 * THE ANSWER is the same whatever the address, and given before anything is
 * looked up, so neither what it says nor how long it takes tells anyone who
 * signs in (OWASP's Forgot Password Cheat Sheet: "Return a consistent message
 * for both existent and non-existent accounts", "in a consistent amount of
 * time"; ASVS 5.0 6.3.8). The work is done after it:
 *
 * - an address confirmed as an active person's is sent a link, good once for an
 *   hour (#lib/server/links), and their password stays as it is until the link
 *   is used ("Do not make a change to the account until a valid token is
 *   presented"), so nobody can lock anyone out by asking;
 * - an address not yet confirmed is sent an email saying so, without a link,
 *   and who can send one;
 * - an unknown address, or a deactivated person's, is sent nothing.
 *
 * LIMITS, against flooding someone's inbox and against automation (ASVS 5.0
 * 2.4.1): a network that has asked ASKS_ALLOWED times in a quarter of an hour
 * waits; and an address asked for again within EMAIL_EVERY of the last ask is
 * sent nothing more. Both count every ask, whether or not anyone signs in with
 * the address, so they say nothing either.
 */

/** Asks a network may make in a quarter of an hour before it waits. */
export const ASKS_ALLOWED = 10;
const WINDOW = sql`interval '15 minutes'`;

/** How soon after one ask an address can be sent another email. */
export const EMAIL_EVERY = sql`interval '5 minutes'`;

/** Whether `address`'s network has asked too often lately to ask again yet. */
export async function askedTooOften(address: string): Promise<boolean> {
	const { network } = placeOf(address);
	const [{ n }] = await db
		.select({ n: count() })
		.from(recoveryAsk)
		.where(
			and(eq(recoveryAsk.network, network), gt(recoveryAsk.createdAt, sql`now() - ${WINDOW}`))
		);
	return n >= ASKS_ALLOWED;
}

/**
 * The ask, recorded, and answered by email if it is to be. Run after the page
 * has answered, so how long it takes is nobody's to see.
 */
export async function recover(address: string, email: string): Promise<void> {
	const key = emailKey(email);
	await db.transaction(async (tx) => {
		// One ask for an address at a time, so two at once do not both send.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recovery ${key}`}))`);
		const [recent] = await tx
			.select({ at: recoveryAsk.createdAt })
			.from(recoveryAsk)
			.where(
				and(eq(recoveryAsk.emailKey, key), gt(recoveryAsk.createdAt, sql`now() - ${EMAIL_EVERY}`))
			)
			.orderBy(desc(recoveryAsk.createdAt))
			.limit(1);
		await tx.delete(recoveryAsk).where(lt(recoveryAsk.createdAt, sql`now() - interval '1 day'`));
		await tx.insert(recoveryAsk).values({ ...placeOf(address), emailKey: key });
		if (recent || cannotSend()) return;

		const [person] = await tx
			.select({ id: user.id, active: user.active, confirmed: user.emailVerified })
			.from(user)
			.where(eq(user.email, email))
			.for('update');
		if (!person?.active) return;
		if (!person.confirmed) {
			await tell(tx, person.id, (them, business) =>
				passwordRecoveryUnconfirmed(them, business, { at: new Date() })
			);
			return;
		}
		const sent = await issue(tx, person.id, 'recover', null);
		await tell(
			tx,
			person.id,
			(them, business) => passwordRecovery(them, business, { at: new Date(), ...sent }),
			sent.until
		);
	});
}
