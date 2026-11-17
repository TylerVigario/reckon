import { db } from '#lib/server/db/index.ts';
import { rules } from '#lib/server/catalogue.ts';
import { anHourNow } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

/**
 * Whom a service pays, and how -- the rules in force and scheduled -- and what
 * the business keeps of an hour of it, worked by each person and by a team.
 */
export const load: PageServerLoad = async ({ params }) => {
	const [paying, hour, roles, people, clients] = await Promise.all([
		rules(params.id),
		anHourNow(),
		// The role people hold first, so a new rule starts on the one in use.
		db
			.selectFrom('role')
			.select(['role.id', 'role.name'])
			.orderBy(
				(eb) =>
					eb
						.selectFrom('user')
						.select((eb) => eb.fn.countAll().as('n'))
						.whereRef('user.role_id', '=', 'role.id')
						.where('user.active', '=', true),
				'desc'
			)
			.orderBy('role.name')
			.execute(),
		db
			.selectFrom('user')
			.select(['id', 'name'])
			.where('active', '=', true)
			.orderBy('name')
			.execute(),
		db
			.selectFrom('entity')
			.select(['id', 'name'])
			.where('active', '=', true)
			.orderBy('name')
			.execute()
	]);
	return {
		rules: paying.filter((r) => r.state !== 'superseded'),
		hour: hour.filter((h) => h.service_id === params.id),
		roles,
		people,
		clients
	};
};
