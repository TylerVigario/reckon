import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { passkey, user } from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, issue, unsentBecause } from '#lib/server/links.ts';
import { endPasskeys } from '#lib/server/passkeys.ts';
import { newPasskeyLink } from '#lib/server/notices.js';
import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Sends someone who can't sign in a new link to make a passkey with: good
 * once, for an hour (#lib/server/links). NIST SP 800-63B-4 §4.2.1 allows
 * recovery through "interaction with a CSP agent": here, someone with Full
 * who knows them. Whoever sends it never sees the link, and the email is the
 * notice that it went (§4.2.3).
 *
 * It adds a passkey, and ends none: a phone left at home still signs them in
 * once they are back to it. Whoever sends it says, every time, whether a
 * phone or computer of theirs is lost or stolen -- `lost`, with no answer
 * taken for granted -- and if one is, every passkey they have ends, and they
 * are signed out everywhere, as it goes (#lib/server/passkeys endPasskeys).
 *
 * Not one's own: those are on Your profile. Not someone yet to make their
 * first, whose invitation is sent again instead (../invitation).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const me = locals.user!;
	if (params.id === me.id) return refuse({ link: 'Your own passkeys are on Your profile.' });
	const missing = cannotSend();
	if (missing) return problem('emailUnset', 409, unsentBecause(missing));
	const lost = (await readBody(request))?.lost;
	if (typeof lost !== 'boolean')
		return refuse({ lost: 'Say whether a phone or computer of theirs is lost or stolen.' });

	return asUser(me.id, async (tx) => {
		const [person] = await tx
			.select({ id: user.id, active: user.active, joined: user.lastSignedInAt })
			.from(user)
			.where(eq(user.id, params.id))
			.for('update');
		if (!person) return problem('notFound', 404, 'No person with that id.');
		if (!person.active) return refuse({ link: 'They’re deactivated. Reactivate them first.' });
		const [keyed] = await tx
			.select({ id: passkey.id })
			.from(passkey)
			.where(eq(passkey.userId, person.id))
			.limit(1);
		if (!keyed && !person.joined)
			return refuse({
				link: 'They haven’t made a passkey yet. Send their invitation again instead.'
			});
		if (lost) await endPasskeys(tx, person.id);
		const sent = await issue(tx, person.id, 'reset', me.id);
		await tell(
			tx,
			person.id,
			(them, business) =>
				newPasskeyLink(them, business, { at: new Date(), by: me.name, ended: lost, ...sent }),
			sent.until
		);
		return Response.json({ sent_to: sent.to, until: sent.until, ended: lost });
	});
};
