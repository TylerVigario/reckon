import { fail } from '@sveltejs/kit';
import { sql, type ExpressionBuilder } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import type { DB } from '#lib/server/db/database.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, changing, issue, unsentBecause } from '#lib/server/links.ts';
import { emailConfirmation } from '#lib/server/notices.js';
import { whomToContact } from '#lib/server/whom-to-contact.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * The signed-in person's own profile: the zone they keep, and how their dates
 * and figures read. Theirs alone; /api/people refuses these fields for anyone
 * else. Each empty one follows the business's, or the locale's. Their passkeys
 * are the tab beside it, /profile/passkeys (+layout.svelte).
 *
 * And the address they sign in with, and whether it is confirmed theirs: one
 * that is not -- anyone added before invitations were emailed -- they confirm
 * here, by a link sent there (#lib/server/links). The address itself is
 * changed on Team, and a change of it waits for them to use the link sent to
 * the new one: said here, with where it went and until when.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [me, waiting, contact] = await Promise.all([
		db
			.selectFrom('user')
			.select((eb) => [
				'email',
				'email_verified',
				'timezone',
				'locale',
				'hour_cycle',
				'week_start',
				changing(eb.ref('user.id')).as('changing')
			])
			.where('id', '=', locals.user!.id)
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('email_link')
			.select('expires_at as until')
			.where(confirmationWaiting(locals.user!.id))
			.executeTakeFirst(),
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
const confirmationWaiting = (userId: string) => (eb: ExpressionBuilder<DB, 'email_link'>) =>
	eb.and([
		eb('email_link.user_id', '=', userId),
		eb('email_link.purpose', '=', 'confirm'),
		eb('email_link.used_at', 'is', null),
		eb('email_link.expires_at', '>', sql<Date>`now()`),
		eb(
			'email_link.sent_to',
			'=',
			eb.selectFrom('user').select('user.email').where('user.id', '=', userId)
		)
	]);

/** How long after one confirmation link another can be asked for. */
const AGAIN_AFTER_SECONDS = 60;

export const actions: Actions = {
	/** Emails a link to confirm the address they sign in with. */
	confirm: async ({ locals }) => {
		const me = locals.user!;
		const missing = cannotSend();
		if (missing) return fail(409, { confirm: unsentBecause(missing) });
		const newest = await db
			.selectFrom('email_link')
			.select((eb) =>
				eb('created_at', '>', sql<Date>`now() - make_interval(secs => ${AGAIN_AFTER_SECONDS})`).as(
					'recent'
				)
			)
			.where('user_id', '=', me.id)
			.where('purpose', '=', 'confirm')
			.orderBy('created_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		if (newest?.recent)
			return fail(429, { confirm: 'One went a moment ago. Give it a minute to arrive.' });

		const sent = await db.transaction().execute(async (tx) => {
			const held = await tx
				.selectFrom('user')
				.select('email_verified as verified')
				.where('id', '=', me.id)
				.forUpdate()
				.executeTakeFirst();
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
