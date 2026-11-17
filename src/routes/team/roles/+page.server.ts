import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * The roles people are paid as, each with what its pay is and who holds it.
 *
 * What a role pays for each kind of work is each service's, and is not here.
 * How many pay rules name a role is, only because a named role can't be
 * deleted, and the screen says why before anyone tries.
 */
export const load: PageServerLoad = async () => {
	const [roles, { people }] = await Promise.all([
		db
			.selectFrom('role')
			.select((eb) => [
				'role.id',
				'role.name',
				'role.pays_as',
				// Everyone, deactivated or not: holding it is what keeps it.
				eb
					.selectFrom('user')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('user.role_id', '=', 'role.id')
					.$asScalar()
					.$notNull()
					.as('holders'),
				eb
					.selectFrom('pay_rule')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('pay_rule.role_id', '=', 'role.id')
					.$asScalar()
					.$notNull()
					.as('rules')
			])
			.orderBy('role.name')
			.execute(),
		db
			.selectFrom('user')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('people'))
			.executeTakeFirstOrThrow()
	]);
	return { roles, people };
};
