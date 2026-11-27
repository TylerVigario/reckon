import { asUser } from '#lib/server/db/index.ts';
import { refuse, refuseAsThingsStand } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { endPasskeys } from '#lib/server/passkeys.ts';
import { passkeysEnded } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Ends every passkey someone has, and signs them out everywhere, there and
 * then, for a phone or computer of theirs that is lost or stolen
 * (#lib/server/passkeys endPasskeys) -- whether or not they can still sign in
 * -- and tells them (NIST SP 800-63B-4 §4.5). They sign in again with a new
 * link (../link). Not one's own, which are on Your profile, one at a time.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No person with that id.');
	const me = locals.user!;
	if (params.id === me.id) return refuse({ passkeys: 'Your own passkeys are on Your profile.' });

	return asUser(me.id, async (tx) => {
		const person = await tx
			.selectFrom('user')
			.select('id')
			.where('id', '=', params.id)
			.forUpdate()
			.executeTakeFirst();
		if (!person) return problem('notFound', 'No person with that id.');
		const keyed = await tx
			.selectFrom('passkey')
			.select('id')
			.where('user_id', '=', person.id)
			.limit(1)
			.executeTakeFirst();
		if (!keyed) return refuseAsThingsStand({ passkeys: 'They have no passkey to end.' });
		const ended = await endPasskeys(tx, person.id);
		await tell(tx, person.id, (them, business) =>
			passkeysEnded(them, business, { at: new Date(), by: me.name })
		);
		return Response.json({ ended });
	});
};
