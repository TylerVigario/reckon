import { asc, count, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { payRule, role, user } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * The roles people are paid as, each with what its pay is and who holds it.
 *
 * What a role pays for each kind of work is each service's, and is not here.
 * How many pay rules name a role is, only because a named role can't be
 * deleted, and the screen says why before anyone tries.
 */
export const load: PageServerLoad = async () => {
	const counted = (n: SQLWrapper) => sql<number>`(${n})::int`;
	const [roles, [{ people }]] = await Promise.all([
		db
			.select({
				id: role.id,
				name: role.name,
				pays_as: role.paysAs,
				// Everyone, deactivated or not: holding it is what keeps it.
				holders: counted(db.select({ n: count() }).from(user).where(eq(user.roleId, role.id))),
				rules: counted(db.select({ n: count() }).from(payRule).where(eq(payRule.roleId, role.id)))
			})
			.from(role)
			.orderBy(asc(role.name)),
		db.select({ people: count() }).from(user)
	]);
	return { roles, people };
};
