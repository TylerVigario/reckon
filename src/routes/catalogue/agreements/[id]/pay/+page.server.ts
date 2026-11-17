import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import type { PageServerLoad } from './$types';

/**
 * An agreement's Pay tab: the rules written for this client alone, in force
 * today -- what covered time pays here is one of them. Each is changed on its
 * service.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { agreement } = await parent();
	const rules = await db
		.selectFrom('pay_rule as pr')
		.innerJoin('service as sv', 'sv.id', 'pr.service_id')
		.leftJoin('role as r', 'r.id', 'pr.role_id')
		.leftJoin('user as u', 'u.id', 'pr.user_id')
		// What it pays for as text, to sort it A to Z rather than in its type's order.
		.distinctOn([
			'pr.service_id',
			'pr.role_id',
			'pr.user_id',
			(eb) => eb.cast<string>('pr.pays_for', 'text')
		])
		.select((eb) => [
			'pr.id',
			'pr.service_id',
			'sv.name as service',
			// A rule names a role or a person, never neither (pay_rule_names_one_payee).
			eb.fn.coalesce('r.name', 'u.name').$notNull().as('payee'),
			'pr.pays_for',
			'pr.method',
			'pr.amount'
		])
		.where('pr.entity_id', '=', agreement.entity_id)
		.where('pr.effective_from', '<=', businessToday())
		.orderBy('pr.service_id')
		.orderBy('pr.role_id')
		.orderBy('pr.user_id')
		.orderBy((eb) => eb.cast('pr.pays_for', 'text'))
		.orderBy('pr.effective_from', 'desc')
		.execute();
	return { rules };
};
