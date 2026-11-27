import { asUser } from '#lib/server/db/index.ts';
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
 * for an hour, and the one before it stops working. The address they have now
 * was told when the change was asked for, and is not told again.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No person with that id.');
	const me = locals.user!;
	const missing = cannotSend();
	if (missing) return problem('emailUnset', unsentBecause(missing));

	return asUser(me.id, async (tx) => {
		const person = await tx
			.selectFrom('user')
			.select('active')
			.where('id', '=', params.id)
			.forUpdate()
			.executeTakeFirst();
		if (!person) return problem('notFound', 'No person with that id.');
		const waiting = await tx
			.selectFrom('email_link')
			.select('sent_to')
			.where('user_id', '=', params.id)
			.where('used_at', 'is', null)
			.where('purpose', '=', 'change')
			.orderBy('created_at', 'desc')
			.limit(1)
			.executeTakeFirst();
		if (!waiting) return problem('notFound', 'They have no change of email waiting.');
		if (!person.active) return refuse({ change: 'They’re deactivated. Reactivate them first.' });
		const taken = await tx
			.selectFrom('user')
			.select('id')
			.where('email', '=', waiting.sent_to)
			.where('id', '<>', params.id)
			.executeTakeFirst();
		if (taken)
			return refuse({
				change: `Someone else signs in with ${waiting.sent_to} now. Cancel this change.`
			});
		const by = me.id === params.id ? null : me.name;
		const sent = await issue(tx, params.id, 'change', me.id, waiting.sent_to);
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
	if (!UUID.test(params.id)) return problem('notFound', 'No person with that id.');
	const ended = await asUser(locals.user!.id, (tx) => endChange(tx, params.id));
	if (!ended) return problem('notFound', 'They have no change of email waiting.');
	return new Response(null, { status: 204 });
};
