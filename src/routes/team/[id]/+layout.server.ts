import { error } from '@sveltejs/kit';
import { and, count, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { passkey, user } from '#lib/server/db/schema/index.ts';
import { cannotSend, changing, signingIn } from '#lib/server/links.ts';
import { UUID } from '#lib/field-rules.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One person, as each of their tabs heads them: who they are, whether they
 * sign in and when they last did, the link to make a passkey they have
 * waiting, a change of their address waiting, how many passkeys they have,
 * and what the menu needs -- whether they are the last on Full, and what
 * reckon is missing to send email, if anything.
 */
export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'Nobody with that id.');
	const [[person], [{ onFull }], [{ passkeys }]] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				active: user.active,
				access: user.access,
				role_id: user.roleId,
				last_signed_in_at: user.lastSignedInAt,
				email_verified: user.emailVerified,
				...signingIn,
				changing
			})
			.from(user)
			.where(eq(user.id, params.id)),
		// Someone active keeps Full; the database refuses otherwise, and the page says so first.
		db
			.select({ onFull: count() })
			.from(user)
			.where(and(eq(user.active, true), eq(user.access, 'full'))),
		db.select({ passkeys: count() }).from(passkey).where(eq(passkey.userId, params.id))
	]);
	if (!person) error(404, 'Nobody with that id.');
	return { person, onFull, passkeys, me: locals.user!.id, cannotSend: cannotSend() };
};
