import { asc, count, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { role, user } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * Everyone who signs in, or did: who they are, what they are paid as and what
 * they can reach, and whether they still sign in. Each opens their own page,
 * where all of it is changed. What anyone is paid is each service's, and is
 * not here.
 */
export const load: PageServerLoad = async () => {
	const [people, [{ roles }]] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				active: user.active,
				access: user.access,
				temporary_password: user.temporaryPassword,
				last_signed_in_at: user.lastSignedInAt,
				role: role.name
			})
			.from(user)
			.leftJoin(role, eq(role.id, user.roleId))
			.orderBy(desc(user.active), asc(user.name)),
		db.select({ roles: count() }).from(role)
	]);
	return { people, roles };
};
