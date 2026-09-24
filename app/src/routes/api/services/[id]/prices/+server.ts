import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { PRICE_FIELDS, readPrice } from '$lib/service-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * A price for a service, from a day: every client's, or one client's.
 *
 * A CHANGE IS A NEW ROW. The price in force stays as it was, and says so on the
 * service's history, because a line worked in June is worth June's price. A
 * day already past can be given, so a price agreed last week can be entered
 * today -- work since then is worth what was agreed.
 *
 * ONE ROW PER CLIENT PER DAY. A second price for the same clients from the same
 * day replaces the first while that day has not passed: a mistake caught the
 * day it is made is corrected, not superseded. Once the day is past, the row is
 * history, and the change is a price from another day.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No service with that id.');

	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = readPrice(fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [service] = await sql<{ id: string }[]>`select id from service where id = ${params.id}`;
	if (!service) return problem('notFound', 404, 'No service with that id.');

	const [same] = await sql<{ id: string; started: boolean }[]>`
		select id, effective_from < current_date as started
		  from service_price
		 where service_id = ${params.id}
		   and entity_id is not distinct from ${values.entity_id}::uuid
		   and effective_from = ${values.effective_from}::date`;
	if (same?.started)
		return refuse({
			effective_from:
				'A price for these clients already starts that day, and the day has passed. Start the change on another day.'
		});

	try {
		const [row] = await asUser(locals.user!.id, (tx) =>
			same
				? tx<{ id: string }[]>`
					update service_price
					   set rate = ${values.rate}, additional_rate = ${values.additional_rate}
					 where id = ${same.id}
					returning id`
				: tx<{ id: string }[]>`
					insert into service_price (service_id, entity_id, rate, additional_rate, effective_from)
					values (${params.id}, ${values.entity_id}, ${values.rate}, ${values.additional_rate},
					        ${values.effective_from})
					returning id`
		);
		return json({ id: row.id, replaced: Boolean(same) }, { status: same ? 200 : 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(PRICE_FIELDS), 'service_price');
		if (refused) return refused;
		throw e;
	}
};
