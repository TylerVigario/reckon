import { asUser } from '#lib/server/db/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { endPasskey } from '#lib/server/passkeys.ts';
import { passkeyEnded } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Ends one of someone's passkeys, there and then, for the phone or computer
 * holding it being lost or stolen, and signs them out everywhere
 * (#lib/server/passkeys endPasskey); their others still work. They are told
 * which, and how to sign in now (NIST SP 800-63B-4 §4.5). Not one's own,
 * which are removed on Your profile.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.passkey))
		return problem('notFound', 404, 'No such passkey.');
	const me = locals.user!;
	if (params.id === me.id) return refuse({ passkey: 'Your own passkeys are on Your profile.' });

	return asUser(me.id, async (tx) => {
		const ended = await endPasskey(tx, params.id, params.passkey);
		if (!ended) return problem('notFound', 404, 'They have no such passkey.');
		await tell(tx, params.id, (them, business) =>
			passkeyEnded(them, business, { ...ended, at: new Date(), by: me.name })
		);
		return Response.json({ left: ended.left });
	});
};
