import { businessToday } from '#lib/server/calendar.ts';
import { and, eq, sql } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import { service, servicePrice } from '#lib/server/db/schema/index.ts';
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

	const [found] = await db
		.select({ id: service.id })
		.from(service)
		.where(eq(service.id, params.id));
	if (!found) return problem('notFound', 404, 'No service with that id.');

	const entityId = values.entity_id === null ? null : String(values.entity_id);
	const effectiveFrom = String(values.effective_from);
	const [same] = await db
		.select({
			id: servicePrice.id,
			started: sql<boolean>`${servicePrice.effectiveFrom} < ${businessToday()}::date`
		})
		.from(servicePrice)
		.where(
			and(
				eq(servicePrice.serviceId, params.id),
				sql`${servicePrice.entityId} is not distinct from ${entityId}::uuid`,
				eq(servicePrice.effectiveFrom, effectiveFrom)
			)
		);
	if (same?.started)
		return refuse({
			effective_from:
				'A price for these clients already starts that day, and the day has passed. Start the change on another day.'
		});

	try {
		const price = { rate: String(values.rate), additionalRate: String(values.additional_rate) };
		const [row] = await asUser(locals.user!.id, (tx) =>
			same
				? tx
						.update(servicePrice)
						.set(price)
						.where(eq(servicePrice.id, same.id))
						.returning({ id: servicePrice.id })
				: tx
						.insert(servicePrice)
						.values({ serviceId: params.id, entityId, effectiveFrom, ...price })
						.returning({ id: servicePrice.id })
		);
		return Response.json({ id: row.id, replaced: Boolean(same) }, { status: same ? 200 : 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(PRICE_FIELDS), 'service_price');
		if (refused) return refused;
		throw e;
	}
};
