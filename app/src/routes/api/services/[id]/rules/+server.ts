import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
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
 * given -- "robin is now a partner" was true before anybody entered it.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No service with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = readRule(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [service] = await sql<{ id: string }[]>`select id from service where id = ${params.id}`;
	if (!service) return problem('notFound', 404, 'No service with that id.');

	const [same] = await sql<{ id: string; started: boolean }[]>`
		select id, effective_from < current_date as started
		  from pay_rule
		 where service_id = ${params.id}
		   and role_id is not distinct from ${values.role_id}::uuid
		   and user_id is not distinct from ${values.user_id}::uuid
		   and entity_id is not distinct from ${values.entity_id}::uuid
		   and pays_for = ${values.pays_for}
		   and effective_from = ${values.effective_from}::date`;
	if (same?.started)
		return refuse({
			effective_from:
				'A rule like this already starts that day, and the day has passed. Start the change on another day.'
		});

	try {
		const [row] = await asUser(locals.user!.id, (tx) =>
			same
				? tx<{ id: string }[]>`
					update pay_rule set method = ${values.method}, amount = ${values.amount}
					 where id = ${same.id}
					returning id`
				: tx<{ id: string }[]>`
					insert into pay_rule (service_id, role_id, user_id, entity_id, pays_for, method,
					                      amount, effective_from)
					values (${params.id}, ${values.role_id}, ${values.user_id}, ${values.entity_id},
					        ${values.pays_for}, ${values.method}, ${values.amount}, ${values.effective_from})
					returning id`
		);
		return json({ id: row.id, replaced: Boolean(same) }, { status: same ? 200 : 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(RULE_FIELDS), 'pay_rule');
		if (refused) return refused;
		throw e;
	}
};
