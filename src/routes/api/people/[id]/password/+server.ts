import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { handOver, temporaryPassword } from '#lib/server/handover.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Resets someone's password: they are signed out everywhere, and this answers
 * with a password to hand them, once, which they replace with their own when
 * they sign in with it (#lib/server/handover).
 *
 * Not one's own. That would sign them out of the screen showing them the
 * password, with nobody else to have handed it to.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	if (params.id === locals.user!.id)
		return refuse({ password: "You can't reset your own password." });

	const { password, hash } = await temporaryPassword();
	const found = await asUser(locals.user!.id, async (tx) => {
		const [person] = await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, params.id))
			.for('update');
		if (!person) return false;
		await handOver(tx, person.id, hash);
		return true;
	});
	if (!found) return problem('notFound', 404, 'No person with that id.');
	return Response.json({ password }, { headers: { 'cache-control': 'no-store' } });
};
