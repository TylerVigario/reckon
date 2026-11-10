import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { emailLink, user } from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, endChange, issue, unsentBecause } from '#lib/server/links.ts';
import { emailChange } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * A change of someone's address that waits for them to use the link sent to
 * the new one (../+server.ts changeEmail, #lib/server/links).
 *
 * POST sends its link again, to the same new address: a new link, good once
 * for 24 hours, and the one before it stops working. The address they have now
 * was told when the change was asked for, and is not told again.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const me = locals.user!;
	const missing = cannotSend();
	if (missing) return problem('emailUnset', 409, unsentBecause(missing));

	return asUser(me.id, async (tx) => {
		const [person] = await tx
			.select({ active: user.active })
			.from(user)
			.where(eq(user.id, params.id))
			.for('update');
		if (!person) return problem('notFound', 404, 'No person with that id.');
		const [waiting] = await tx
			.select({ to: emailLink.sentTo })
			.from(emailLink)
			.where(
				and(
					eq(emailLink.userId, params.id),
					isNull(emailLink.usedAt),
					eq(emailLink.purpose, 'change')
				)
			)
			.orderBy(desc(emailLink.createdAt))
			.limit(1);
		if (!waiting) return problem('notFound', 404, 'They have no change of email waiting.');
		if (!person.active) return refuse({ change: 'They’re deactivated. Reactivate them first.' });
		const [taken] = await tx
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.email, waiting.to), ne(user.id, params.id)));
		if (taken)
			return refuse({
				change: `Someone else signs in with ${waiting.to} now. Cancel this change.`
			});
		const by = me.id === params.id ? null : me.name;
		const sent = await issue(tx, params.id, 'change', me.id, waiting.to);
		await tell(
			tx,
			params.id,
			(them, business) => emailChange(them, business, { by, ...sent }),
			sent.until
		);
		return Response.json({ sent_to: sent.to, until: sent.until });
	});
};

/** DELETE cancels it: they keep the address they have, and its link stops working. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const ended = await asUser(locals.user!.id, (tx) => endChange(tx, params.id));
	if (!ended) return problem('notFound', 404, 'They have no change of email waiting.');
	return new Response(null, { status: 204 });
};
