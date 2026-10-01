import { and, asc, count, desc, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { payRule, role, user } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

/**
 * Who works here, and the capacity each is paid in.
 *
 * What a person is paid is not here: it is a service's pay rules, written
 * against a role or against one person, and shown with the service they pay
 * for. This screen says who holds which role -- which rules can reach them --
 * and how many rules name a person or a role directly.
 */
export const load: PageServerLoad = async () => {
	const counted = (n: SQLWrapper) => sql<number>`(${n})::int`;
	const holders = counted(
		db
			.select({ n: count() })
			.from(user)
			.where(and(eq(user.roleId, role.id), eq(user.active, true)))
	);
	const [people, roles] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				active: user.active,
				role_id: user.roleId,
				role: role.name,
				own_rules: counted(
					db.select({ n: count() }).from(payRule).where(eq(payRule.userId, user.id))
				)
			})
			.from(user)
			.leftJoin(role, eq(role.id, user.roleId))
			.orderBy(desc(user.active), asc(user.name)),
		db
			.select({
				id: role.id,
				name: role.name,
				holders,
				rules: counted(db.select({ n: count() }).from(payRule).where(eq(payRule.roleId, role.id)))
			})
			.from(role)
			.orderBy(desc(holders), asc(role.name))
	]);

	return { people, roles };
};
