import { fail } from '@sveltejs/kit';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { emailLink, user } from '#lib/server/db/schema/index.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, changing, issue, unsentBecause } from '#lib/server/links.ts';
import { emailConfirmation } from '#lib/server/notices.js';
import { whomToContact } from '#lib/server/whom-to-contact.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * The signed-in person's own profile: the zone they keep, and how their dates
 * and figures read. Theirs alone; /api/people refuses these fields for anyone
 * else. Each empty one follows the business's, or the locale's. Their passkeys
 * are on a page of their own beside it, /profile/passkeys.
 *
 * And the address they sign in with, and whether it is confirmed theirs: one
 * that is not -- anyone added before invitations were emailed -- they confirm
 * here, by a link sent there (#lib/server/links). The address itself is
 * changed on Team, and a change of it waits for them to use the link sent to
 * the new one: said here, with where it went and until when.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [[me], [waiting], contact] = await Promise.all([
		db
			.select({
				email: user.email,
				email_verified: user.emailVerified,
				timezone: user.timezone,
				locale: user.locale,
				hour_cycle: user.hourCycle,
				week_start: user.weekStart,
				changing
			})
			.from(user)
			.where(eq(user.id, locals.user!.id)),
		db
			.select({ until: emailLink.expiresAt })
			.from(emailLink)
			.where(confirmationWaiting(locals.user!.id)),
		whomToContact()
	]);
	return {
		me,
		// Whom to contact for another link, where they cannot send one
		// themselves: someone with Full sends one from Team.
		contact,
		full: locals.user!.access === 'full',
		confirmation: waiting ? { until: waiting.until } : null,
		businessZone: locals.businessZone,
		businessLocale: locals.businessLocale
	};
};

/** A confirmation link of theirs still working, to the address they have now. */
const confirmationWaiting = (userId: string) =>
	and(
		eq(emailLink.userId, userId),
		eq(emailLink.purpose, 'confirm'),
		isNull(emailLink.usedAt),
		gt(emailLink.expiresAt, sql`now()`),
		sql`${emailLink.sentTo} = (select ${user.email} from ${user} where ${user.id} = ${userId})`
	);

/** How long after one confirmation link another can be asked for. */
const AGAIN_AFTER_SECONDS = 60;

export const actions: Actions = {
	/** Emails a link to confirm the address they sign in with. */
	confirm: async ({ locals }) => {
		const me = locals.user!;
		const missing = cannotSend();
		if (missing) return fail(409, { confirm: unsentBecause(missing) });
		const [newest] = await db
			.select({
				recent: sql<boolean>`${emailLink.createdAt} > now() - make_interval(secs => ${AGAIN_AFTER_SECONDS})`
			})
			.from(emailLink)
			.where(and(eq(emailLink.userId, me.id), eq(emailLink.purpose, 'confirm')))
			.orderBy(desc(emailLink.createdAt))
			.limit(1);
		if (newest?.recent)
			return fail(429, { confirm: 'One went a moment ago. Give it a minute to arrive.' });

		const sent = await db.transaction(async (tx) => {
			const [held] = await tx
				.select({ verified: user.emailVerified })
				.from(user)
				.where(eq(user.id, me.id))
				.for('update');
			if (held?.verified) return null;
			const link = await issue(tx, me.id, 'confirm', me.id);
			await tell(
				tx,
				me.id,
				(them, business) => emailConfirmation(them, business, link),
				link.until
			);
			return link;
		});
		return sent ? { sent: { to: sent.to } } : { confirmed: true };
	}
};
