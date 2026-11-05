import { error } from '@sveltejs/kit';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { role, user } from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One person: who they are, what they can reach, the role they are paid as,
 * and whether they sign in -- each changed here, and nowhere else -- and when
 * they last did, and whether they have yet to choose their own password. What they are owed is the pay report's, and is a link from
 * here.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'Nobody with that id.');
	const [[person], roles, [{ onFull }]] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				active: user.active,
				access: user.access,
				role_id: user.roleId,
				last_signed_in_at: user.lastSignedInAt,
				temporary_password: user.temporaryPassword
			})
			.from(user)
			.where(eq(user.id, params.id)),
		db
			.select({ id: role.id, name: role.name, pays_as: role.paysAs })
			.from(role)
			.orderBy(asc(role.name)),
		// Someone active keeps Full; the database refuses otherwise, and the page says so first.
		db
			.select({ onFull: count() })
			.from(user)
			.where(and(eq(user.active, true), eq(user.access, 'full')))
	]);
	if (!person) error(404, 'Nobody with that id.');
	return { person, roles, onFull, me: locals.user!.id };
};
