import { asUser } from '#lib/server/db/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, issue, unsentBecause } from '#lib/server/links.ts';
import { invitation } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Sends someone their invitation again, a new link to make their first passkey
 * with (#lib/server/links). Only for someone yet to make one; after that, a
 * new link is sent instead (../link).
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No person with that id.');
	const me = locals.user!;
	const missing = cannotSend();
	if (missing) return problem('emailUnset', unsentBecause(missing));

	return asUser(me.id, async (tx) => {
		const person = await tx
			.selectFrom('user')
			.select(['id', 'active', 'last_signed_in_at'])
			.where('id', '=', params.id)
			.forUpdate()
			.executeTakeFirst();
		if (!person) return problem('notFound', 'No person with that id.');
		if (!person.active)
			return refuse({ invitation: 'They’re deactivated. Reactivate them first.' });
		const held = await tx
			.selectFrom('passkey')
			.select('id')
			.where('user_id', '=', person.id)
			.limit(1)
			.executeTakeFirst();
		if (held || person.last_signed_in_at)
			return refuse({
				invitation: 'They’ve made a passkey already. Send them a new link if they’ve lost it.'
			});
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
