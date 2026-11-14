import { eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import { service, servicePrice, UNITS } from '#lib/server/db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { isoDate, UUID } from '#lib/field-rules.ts';
import { readNewService } from '#lib/service-fields.ts';
import { insertNamed } from '#lib/server/slugs.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { madeAt } from '#lib/server/made-at.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readBody } from '#lib/json.ts';

/** The service added with this uuid, if one was. */
async function madeWith(clientUuid: string) {
	const [had] = await db
		.select({ id: service.id })
		.from(service)
		.where(eq(service.clientUuid, clientUuid));
	return had?.id ?? null;
}

/**
 * Creates a service, from a name and what it is charged per.
 *
 * Nothing else is asked for, because nothing else is needed to exist: a price
 * and a pay rule are each added on the service's own screen,
 * dated from the day they start. An hourly service starts billing to the
 * nearest minute, like every hourly service already does.
 *
 * `code` is the service's internal handle and nobody types it. It is made from
 * the name, and numbered when two names read the same.
 *
 * Its price for every client may come with it (#lib/service-fields
 * readNewService), from the day it was added: what a phone with no signal
 * says, since the service's own screen cannot open there until it arrives.
 * From the page or a phone's queue (#lib/queue), with the uuid it was added
 * with: one sent twice is answered with the one already made, and a time
 * entry or trip that named it meanwhile finds it by that uuid.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await readBody(request);
	const fields = body?.fields;
	if (!fields || typeof fields !== 'object' || Array.isArray(fields))
		return problem('malformed', 400, 'Expected { fields: { name: value }, client_uuid }.');
	const clientUuid = typeof body.client_uuid === 'string' ? body.client_uuid : '';
	if (!UUID.test(clientUuid)) return refuse({ client_uuid: 'The uuid it was added with.' });
	const had = await madeWith(clientUuid);
	if (had) return Response.json({ id: had });

	const { values, errors } = readNewService(fields as Record<string, unknown>);
	if (Object.keys(errors).length > 0) return refuse(errors);
	// Priced from the day it was added, where a phone says one: never after today.
	const said = typeof body.from === 'string' ? isoDate(body.from) : null;
	const today = businessToday();
	const from = said?.ok && String(said.value) <= today ? String(said.value) : today;

	try {
		const [made] = await asUser(
			locals.user!.id,
			async (tx) => {
				const added = await insertNamed(
					tx,
					{
						given: null,
						from: String(values.name),
						fallback: 'service',
						constraint: 'service_code_key'
					},
					(tx, code) =>
						tx
							.insert(service)
							.values({
								code,
								name: String(values.name),
								unit: String(values.unit) as (typeof UNITS)[number],
								billToNearestSeconds: values.unit === 'hour' ? 60 : null,
								clientUuid
							})
							.returning({ id: service.id })
				);
				if (values.rate !== null)
					await tx.insert(servicePrice).values({
						serviceId: added[0].id,
						entityId: null,
						rate: String(values.rate),
						additionalRate: String(values.additional_rate),
						effectiveFrom: from
					});
				return added;
			},
			madeAt(typeof body.made_at === 'string' ? body.made_at : '')
		);
		return Response.json({ id: made.id }, { status: 201 });
	} catch (e) {
		// Sent twice at once: the other one made it.
		if (pgError(e).constraint === 'service_client_uuid_key') {
			const id = await madeWith(clientUuid);
			if (id) return Response.json({ id });
		}
		const refused = refuseIfTheDatabaseSaidSo(e, ['name', 'unit'], 'service');
		if (refused) return refused;
		throw e;
	}
};
