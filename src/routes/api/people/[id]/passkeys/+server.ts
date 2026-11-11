import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { passkey, user } from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
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
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const me = locals.user!;
	if (params.id === me.id) return refuse({ passkeys: 'Your own passkeys are on Your profile.' });

	return asUser(me.id, async (tx) => {
		const [person] = await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, params.id))
			.for('update');
		if (!person) return problem('notFound', 404, 'No person with that id.');
		const [keyed] = await tx
			.select({ id: passkey.id })
			.from(passkey)
			.where(eq(passkey.userId, person.id))
			.limit(1);
		if (!keyed) return refuse({ passkeys: 'They have no passkey to end.' }, 409);
		const ended = await endPasskeys(tx, person.id);
		await tell(tx, person.id, (them, business) =>
			passkeysEnded(them, business, { at: new Date(), by: me.name })
		);
		return Response.json({ ended });
	});
};
