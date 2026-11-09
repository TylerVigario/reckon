import { and, eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { account, session, user } from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, issue, unsentBecause } from '#lib/server/links.ts';
import { invitation } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Sends someone's invitation again, to the address they sign in with now: a
 * new link, good once for 24 hours, and the one before it stops working
 * (#lib/server/links). Only for someone yet to choose their first password;
 * after that, theirs is reset instead (../password). Someone handed a
 * temporary password before invitations were emailed is yet to choose too,
 * and that password stops working.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const me = locals.user!;
	const missing = cannotSend();
	if (missing) return problem('emailUnset', 409, unsentBecause(missing));

	return asUser(me.id, async (tx) => {
		const [person] = await tx
			.select({
				id: user.id,
				active: user.active,
				joined: user.lastSignedInAt,
				temporary: user.temporaryPassword
			})
			.from(user)
			.where(eq(user.id, params.id))
			.for('update');
		if (!person) return problem('notFound', 404, 'No person with that id.');
		if (!person.active)
			return refuse({ invitation: 'They’re deactivated. Reactivate them first.' });
		const credential = and(eq(account.userId, person.id), eq(account.providerId, 'credential'));
		const [held] = await tx.select({ id: account.id }).from(account).where(credential);
		if ((held && !person.temporary) || person.joined)
			return refuse({
				invitation: 'They’ve chosen a password already. Reset it if they’ve lost it.'
			});
		if (held) {
			await tx.delete(account).where(credential);
			await tx.update(user).set({ temporaryPassword: false }).where(eq(user.id, person.id));
			await tx.delete(session).where(eq(session.userId, person.id));
		}
		const sent = await issue(tx, person.id, 'invite', me.id);
		await tell(
			tx,
			person.id,
			(them, business) => invitation(them, business, { by: me.name, ...sent }),
			sent.until
		);
		return Response.json({ sent_to: sent.to, until: sent.until });
	});
};
