import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { SITE_URL } from '$app/env/private';
import { actingAs, db, type Tx } from './db/index.ts';
import { emailLink, linkTry, passkey, user, type LINK_PURPOSES } from './db/schema/index.ts';
import type { Changing, Waiting } from '#lib/people-fields.ts';
import { mailer } from './email.ts';
import { placeOf } from './network.ts';
import { record, recordAside } from './events.ts';

/**
 * LINKS reckon emails (email_link): an invitation to make a first passkey, a
 * new link to make one with after the old are lost (a "reset"), a link
 * confirming the address one signs in with, and one making a new address the
 * one they sign in with. Each carries a code, and is good once, for an hour.
 * NIST SP 800-63A-4 §3.8 and SP 800-63B-4 §4.2.1.2 allow a code sent by email
 * at most 24 hours; an invitation or a new link now lets whoever opens it first
 * make a passkey for that account, so it lasts as long as a credential handed
 * over does -- Microsoft Entra's Temporary Access Pass defaults to an hour --
 * and another is one click on Team.
 *
 * THE CODE is 32 random bytes, written in base64url: 256 bits, past the 112
 * NIST asks of any secret (SP 800-63B-4 §3.2.12). Only its SHA-256 is kept, so
 * nobody who reads the table can use what is in it. It is in the email and
 * nowhere else, and never in the part of the link a server sees: a link is
 * SITE_URL/link#<code>, and what follows the # stays in the browser (ASVS 5.0
 * 14.2.1), out of every server's log and every Referer header, and out of
 * reach of a mail scanner that opens links to see where they go. The page
 * reads it there and posts it.
 *
 * THE LINK begins with SITE_URL, never the address a request came in on, which
 * a request can say anything about (OWASP's Forgot Password Cheat Sheet).
 *
 * A link works only while the address it went to is still the one its person
 * signs in with, and while they are active. Using it proves they read mail
 * there, and marks the address confirmed. A change's link went to the address
 * they are to sign in with instead: it works while they are active, until a
 * newer change or a cancelled one ends it, and using it makes that address
 * theirs (SP 800-63B-4 §4.2.1.2: an address "SHALL be established only after
 * the subscriber provides the correct confirmation code"). A code that is not one to use --
 * unknown, used or lapsed -- is answered alike, so the page says nothing about
 * which codes exist, and counts against the network it came from.
 */

export type Purpose = (typeof LINK_PURPOSES)[number];

/** How long a link works, in minutes: an hour, every one (see above). */
export const LINK_MINUTES = {
	invite: 60,
	reset: 60,
	confirm: 60,
	change: 60
} as const satisfies Record<Purpose, number>;

/** A code as a link carries it: 32 bytes of base64url, unpadded. */
export const CODE = /^[A-Za-z0-9_-]{43}$/;

/** What is kept of a code. */
export const hashOf = (code: string) => createHash('sha256').update(code).digest();

/** What reckon is missing to send a link, or null when it has all it needs. */
export function cannotSend(): 'SMTP_HOST' | 'SITE_URL' | null {
	if (!mailer()) return 'SMTP_HOST';
	if (!SITE_URL) return 'SITE_URL';
	return null;
}

/** Said wherever a link can't be sent for want of a setting. */
export const unsentBecause = (missing: 'SMTP_HOST' | 'SITE_URL') =>
	missing === 'SMTP_HOST'
		? 'Email isn’t set up: SMTP_HOST is unset, so reckon has no relay to send it through.'
		: 'Email isn’t set up: SITE_URL is unset, so reckon has no address to build the link from.';

/** The purposes a link that makes a passkey has: an invitation or a new link, one at a time. */
export const MAKES_PASSKEY = ['invite', 'reset'] as const;

/** What else a link ends when it is issued: any other of its kind still waiting. */
const ALIKE = {
	invite: MAKES_PASSKEY,
	reset: MAKES_PASSKEY,
	confirm: ['confirm'],
	change: ['change']
} as const satisfies Record<Purpose, readonly Purpose[]>;

/**
 * A new link for `userId`, to the address they sign in with now -- or, for a
 * change, to `changeTo`, the one they are to sign in with: any other of the
 * same kind still waiting stops working. The link, and until when it works.
 * Called in the transaction that emails it, so neither is kept without the
 * other.
 */
export async function issue(
	tx: Tx,
	userId: string,
	purpose: Purpose,
	sentBy: string | null,
	changeTo?: string
): Promise<{ link: string; until: Date; to: string }> {
	if (!SITE_URL) throw new Error('A link is issued only where SITE_URL is set.');
	if ((purpose === 'change') !== (changeTo !== undefined))
		throw new Error('A change, and only a change, is sent to an address of its own.');
	const [person] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
	if (!person) throw new Error(`Nobody has the id ${userId}.`);
	const to = changeTo ?? person.email;
	const code = randomBytes(32).toString('base64url');
	const alike = ALIKE[purpose];
	await tx
		.delete(emailLink)
		.where(
			and(
				eq(emailLink.userId, userId),
				isNull(emailLink.usedAt),
				inArray(emailLink.purpose, [...alike])
			)
		);
	// The record of links used is kept 90 days.
	await tx.delete(emailLink).where(lt(emailLink.usedAt, sql`now() - interval '90 days'`));
	const [made] = await tx
		.insert(emailLink)
		.values({
			userId,
			purpose,
			codeHash: hashOf(code),
			sentTo: to,
			expiresAt: sql`now() + make_interval(mins => ${LINK_MINUTES[purpose]})`,
			sentBy
		})
		.returning({ until: emailLink.expiresAt });
	await record(tx, 'authn_link_issued', { user: userId, by: sentBy, detail: { purpose } });
	return { link: `${SITE_URL}/link#${code}`, until: made.until, to };
}

/**
 * A link that can be used now, and its person, as the page speaks of them:
 * `email` is the address it went to, which for a change is the new one.
 */
export type Usable = {
	id: string;
	purpose: Purpose;
	userId: string;
	name: string;
	email: string;
};

/**
 * The link `code` names, if it can be used now, held for the rest of the
 * transaction so it is used once however many tries arrive at once. Null for
 * any code that is not one to use.
 */
export async function usable(tx: Tx, code: string): Promise<Usable | null> {
	if (!CODE.test(code)) return null;
	const [found] = await tx
		.select({
			id: emailLink.id,
			purpose: emailLink.purpose,
			userId: emailLink.userId,
			name: user.name,
			email: emailLink.sentTo
		})
		.from(emailLink)
		.innerJoin(user, eq(user.id, emailLink.userId))
		.where(
			and(
				eq(emailLink.codeHash, hashOf(code)),
				isNull(emailLink.usedAt),
				gt(emailLink.expiresAt, sql`now()`),
				eq(user.active, true),
				or(eq(emailLink.purpose, 'change'), eq(user.email, emailLink.sentTo))
			)
		)
		.for('update', { of: [emailLink, user] });
	return found ?? null;
}

/**
 * The link to make a passkey with -- an invitation or a new one sent on Team --
 * by its id, if it can be used now, held for the rest of the transaction as
 * usable() holds one. The id is not a secret: it is only ever taken from
 * reckon's own code, which has looked the code up first (#lib/server/passkeys).
 */
export async function usableById(tx: Tx, id: string): Promise<Usable | null> {
	const [found] = await tx
		.select({
			id: emailLink.id,
			purpose: emailLink.purpose,
			userId: emailLink.userId,
			name: user.name,
			email: emailLink.sentTo
		})
		.from(emailLink)
		.innerJoin(user, eq(user.id, emailLink.userId))
		.where(
			and(
				eq(emailLink.id, id),
				isNull(emailLink.usedAt),
				gt(emailLink.expiresAt, sql`now()`),
				eq(user.active, true),
				eq(user.email, emailLink.sentTo),
				inArray(emailLink.purpose, [...MAKES_PASSKEY])
			)
		)
		.for('update', { of: [emailLink, user] });
	return found ?? null;
}

/** Marks a link used, and the address it went to proven theirs. */
export async function used(tx: Tx, link: Usable): Promise<void> {
	// Whatever the link changes is theirs, in record_history.
	await actingAs(tx, link.userId);
	await tx
		.update(emailLink)
		.set({ usedAt: sql`now()` })
		.where(eq(emailLink.id, link.id));
	await tx.update(user).set({ emailVerified: true }).where(eq(user.id, link.userId));
	await record(tx, 'authn_link_used', {
		user: link.userId,
		by: null,
		detail: { purpose: link.purpose }
	});
}

/**
 * Ends any link to make a passkey that `userId` has waiting, once they have
 * made one with another: a link still working after would undo it (OWASP's
 * Forgot Password Cheat Sheet).
 */
export async function endPasskeyLinks(tx: Tx, userId: string): Promise<void> {
	await tx
		.delete(emailLink)
		.where(
			and(
				eq(emailLink.userId, userId),
				isNull(emailLink.usedAt),
				inArray(emailLink.purpose, [...MAKES_PASSKEY])
			)
		);
}

/** Codes a network may try that are not one to use, in a window, before it waits. */
export const MISSES_ALLOWED = 10;
const WINDOW = sql`interval '15 minutes'`;

/** Whether `address`'s network has missed too often lately to try again yet. */
export async function turnedAway(address: string): Promise<boolean> {
	const { network } = placeOf(address);
	const [{ n }] = await db
		.select({ n: count() })
		.from(linkTry)
		.where(and(eq(linkTry.network, network), gt(linkTry.createdAt, sql`now() - ${WINDOW}`)));
	if (n < MISSES_ALLOWED) return false;
	await recordAside('excess_rate_limit_exceeded', {
		user: null,
		by: null,
		detail: { tried: 'link codes' }
	});
	return true;
}

/** Counts a code that was not one to use against `address`'s network. */
export async function missed(address: string): Promise<void> {
	await db.delete(linkTry).where(lt(linkTry.createdAt, sql`now() - interval '1 day'`));
	await db.insert(linkTry).values(placeOf(address));
	await recordAside('authn_link_refused', { user: null, by: null });
}

/**
 * What Team reads of each person's signing in, as columns of a select from
 * user: whether they have a passkey, and the newest link to make one they have
 * waiting (#lib/people-fields Waiting). The person is named as "user"
 * outright: Drizzle leaves a column unqualified in a query of one table, and
 * inside these it would be read as the inner table's own.
 */
export const signingIn = {
	has_passkey: sql<boolean>`exists (
		select 1 from ${passkey} where ${passkey.userId} = "user".id)`,
	waiting: sql<Waiting | null>`(
		select json_build_object(
			'purpose', l.purpose,
			'sent_at', l.created_at,
			'until', l.expires_at,
			'lapsed', l.expires_at <= now() or l.sent_to <> "user".email)
		  from ${emailLink} l
		 where l.user_id = "user".id and l.used_at is null and l.purpose in ('invite', 'reset')
		 order by l.created_at desc limit 1)`
};

/**
 * A change of their address still waiting, as a column of a select from user:
 * the address it is to, when its link went and until when it works, or null
 * (#lib/people-fields Changing). "user" outright, as in signingIn.
 */
export const changing = sql<Changing | null>`(
	select json_build_object(
		'to', l.sent_to,
		'sent_at', l.created_at,
		'until', l.expires_at,
		'lapsed', l.expires_at <= now())
	  from ${emailLink} l
	 where l.user_id = "user".id and l.used_at is null and l.purpose = 'change'
	 order by l.created_at desc limit 1)`;

/** Ends a change of `userId`'s address still waiting: its link stops working. */
export async function endChange(tx: Tx, userId: string): Promise<boolean> {
	const ended = await tx
		.delete(emailLink)
		.where(
			and(eq(emailLink.userId, userId), isNull(emailLink.usedAt), eq(emailLink.purpose, 'change'))
		)
		.returning({ id: emailLink.id });
	return ended.length > 0;
}
