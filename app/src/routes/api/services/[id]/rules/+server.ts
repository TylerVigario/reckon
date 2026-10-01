import { json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { asUser, db } from '$lib/server/db';
import { PAY_METHODS, PAYS_FOR, payRule, service } from '$lib/server/db/schema';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { readRule, RULE_FIELDS } from '$lib/service-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

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
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No service with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = readRule(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [found] = await db
		.select({ id: service.id })
		.from(service)
		.where(eq(service.id, params.id));
	if (!found) return problem('notFound', 404, 'No service with that id.');

	const idOrNull = (v: string | number | boolean | null) => (v === null ? null : String(v));
	const scope = {
		roleId: idOrNull(values.role_id),
		userId: idOrNull(values.user_id),
		entityId: idOrNull(values.entity_id),
		paysFor: String(values.pays_for) as (typeof PAYS_FOR)[number],
		effectiveFrom: String(values.effective_from)
	};
	const [same] = await db
		.select({ id: payRule.id, started: sql<boolean>`${payRule.effectiveFrom} < current_date` })
		.from(payRule)
		.where(
			and(
				eq(payRule.serviceId, params.id),
				sql`${payRule.roleId} is not distinct from ${scope.roleId}::uuid`,
				sql`${payRule.userId} is not distinct from ${scope.userId}::uuid`,
				sql`${payRule.entityId} is not distinct from ${scope.entityId}::uuid`,
				eq(payRule.paysFor, scope.paysFor),
				eq(payRule.effectiveFrom, scope.effectiveFrom)
			)
		);
	if (same?.started)
		return refuse({
			effective_from:
				'A rule like this already starts that day, and the day has passed. Start the change on another day.'
		});

	try {
		const how = {
			method: String(values.method) as (typeof PAY_METHODS)[number],
			amount: values.amount === null ? null : String(values.amount)
		};
		const [row] = await asUser(locals.user!.id, (tx) =>
			same
				? tx.update(payRule).set(how).where(eq(payRule.id, same.id)).returning({ id: payRule.id })
				: tx
						.insert(payRule)
						.values({ serviceId: params.id, ...scope, ...how })
						.returning({ id: payRule.id })
		);
		return json({ id: row.id, replaced: Boolean(same) }, { status: same ? 200 : 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(RULE_FIELDS), 'pay_rule');
		if (refused) return refused;
		throw e;
	}
};
