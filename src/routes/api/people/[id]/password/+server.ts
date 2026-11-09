import { and, eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { account, session, user } from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, issue, unsentBecause } from '#lib/server/links.ts';
import { passwordResetLink } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Resets someone's password: it stops working, they are signed out
 * everywhere, and they are emailed a link to choose a new one, good once for
 * 24 hours (#lib/server/links). Whoever resets it never sees a password, so
 * cannot choose one for them (ASVS 5.0 6.4.6), and the email is the notice
 * that it happened (NIST SP 800-63B-4 §4.2.3).
 *
 * Not one's own: that is changed on Your profile, with the one it replaces.
 * Not someone yet to choose their first, whose invitation is sent again
 * instead (../invitation).
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const me = locals.user!;
	if (params.id === me.id)
		return refuse({ password: 'Change your own on Your profile, with the one you have.' });
	const missing = cannotSend();
	if (missing) return problem('emailUnset', 409, unsentBecause(missing));

	const answer = await asUser(me.id, async (tx) => {
		const [person] = await tx
			.select({ id: user.id, active: user.active, joined: user.lastSignedInAt })
			.from(user)
			.where(eq(user.id, params.id))
			.for('update');
		if (!person) return problem('notFound', 404, 'No person with that id.');
		if (!person.active) return refuse({ password: 'They’re deactivated. Reactivate them first.' });
		const credential = and(eq(account.userId, person.id), eq(account.providerId, 'credential'));
		const [held] = await tx.select({ id: account.id }).from(account).where(credential);
		if (!held && !person.joined)
			return refuse({
				password: 'They haven’t chosen a password yet. Send their invitation again instead.'
			});

		// A reset that left the old password working, or a session alive, would
		// have changed nothing for whoever holds either.
		await tx.delete(account).where(credential);
		await tx.update(user).set({ temporaryPassword: false }).where(eq(user.id, person.id));
		await tx.delete(session).where(eq(session.userId, person.id));
		const sent = await issue(tx, person.id, 'reset', me.id);
		await tell(
			tx,
			person.id,
			(them, business) =>
				passwordResetLink(them, business, { at: new Date(), by: me.name, ...sent }),
			sent.until
		);
		return Response.json({ sent_to: sent.to, until: sent.until });
	});
	return answer;
};
