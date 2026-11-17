import { businessToday } from '#lib/server/calendar.ts';
import { asUser, db } from '#lib/server/db/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { PRICE_FIELDS, readPrice } from '#lib/service-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

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

	const found = await db
		.selectFrom('service')
		.select('id')
		.where('id', '=', params.id)
		.executeTakeFirst();
	if (!found) return problem('notFound', 404, 'No service with that id.');

	const entityId = values.entity_id === null ? null : String(values.entity_id);
	const effectiveFrom = String(values.effective_from);
	const same = await db
		.selectFrom('service_price')
		.select((eb) => ['id', eb('effective_from', '<', businessToday()).as('started')])
		.where('service_id', '=', params.id)
		.where('entity_id', 'is not distinct from', entityId)
		.where('effective_from', '=', effectiveFrom)
		.executeTakeFirst();
	if (same?.started)
		return refuse({
			effective_from:
				'A price for these clients already starts that day, and the day has passed. Start the change on another day.'
		});

	try {
		const price = { rate: String(values.rate), additional_rate: String(values.additional_rate) };
		const row = await asUser(locals.user!.id, (tx) =>
			same
				? tx
						.updateTable('service_price')
						.set(price)
						.where('id', '=', same.id)
						.returning('id')
						.executeTakeFirstOrThrow()
				: tx
						.insertInto('service_price')
						.values({
							service_id: params.id,
							entity_id: entityId,
							effective_from: effectiveFrom,
							...price
						})
						.returning('id')
						.executeTakeFirstOrThrow()
		);
		return Response.json({ id: row.id, replaced: Boolean(same) }, { status: same ? 200 : 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(PRICE_FIELDS), 'service_price');
		if (refused) return refused;
		throw e;
	}
};
