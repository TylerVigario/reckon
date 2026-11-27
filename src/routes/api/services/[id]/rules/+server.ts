import { businessToday } from '#lib/server/calendar.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import type { PayRuleMethod, PaysFor } from '#lib/server/db/database.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { readRule, RULE_FIELDS } from '#lib/service-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * A pay rule for a service, from a day: whom it pays, for what, how, and for
 * which clients.
 *
 * Dated like a price, and for the same reason: work is paid by the rule in
 * force the day it was done. A change is a new rule from a later day; a rule
 * for the same payee, the same thing and the same clients from the same day
 * replaces the first while that day has not passed. A day already past can be
 * given -- a change of role was true before anybody entered it.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 'No service with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 'Expected { fields: { name: value } }.');

	const { values, errors } = readRule(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const found = await db
		.selectFrom('service')
		.select('id')
		.where('id', '=', params.id)
		.executeTakeFirst();
	if (!found) return problem('notFound', 'No service with that id.');

	const idOrNull = (v: string | number | boolean | null) => (v === null ? null : String(v));
	const scope = {
		role_id: idOrNull(values.role_id),
		user_id: idOrNull(values.user_id),
		entity_id: idOrNull(values.entity_id),
		pays_for: String(values.pays_for) as PaysFor,
		effective_from: String(values.effective_from)
	};
	const same = await db
		.selectFrom('pay_rule')
		.select((eb) => ['id', eb('effective_from', '<', businessToday()).as('started')])
		.where('service_id', '=', params.id)
		.where('role_id', 'is not distinct from', scope.role_id)
		.where('user_id', 'is not distinct from', scope.user_id)
		.where('entity_id', 'is not distinct from', scope.entity_id)
		.where('pays_for', '=', scope.pays_for)
		.where('effective_from', '=', scope.effective_from)
		.executeTakeFirst();
	if (same?.started)
		return refuse({
			effective_from:
				'A rule like this already starts that day, and the day has passed. Start the change on another day.'
		});

	try {
		const how = {
			method: String(values.method) as PayRuleMethod,
			amount: values.amount === null ? null : String(values.amount)
		};
		const row = await asUser(locals.user!.id, (tx) =>
			same
				? tx
						.updateTable('pay_rule')
						.set(how)
						.where('id', '=', same.id)
						.returning('id')
						.executeTakeFirstOrThrow()
				: tx
						.insertInto('pay_rule')
						.values({ service_id: params.id, ...scope, ...how })
						.returning('id')
						.executeTakeFirstOrThrow()
		);
		return Response.json({ id: row.id, replaced: Boolean(same) }, { status: same ? 200 : 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(RULE_FIELDS), 'pay_rule');
		if (refused) return refused;
		throw e;
	}
};
