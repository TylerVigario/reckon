import { json } from '@sveltejs/kit';
import { asUser } from '$lib/server/db';
import { service, UNITS } from '$lib/server/db/schema';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { parseAll } from '$lib/field-rules';
import { NEW_SERVICE_FIELDS } from '$lib/service-fields';
import { insertNamed } from '$lib/server/slugs';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

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
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const { values, errors } = parseAll(NEW_SERVICE_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const [made] = await asUser(locals.user!.id, (tx) =>
			insertNamed(
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
							billToNearestSeconds: values.unit === 'hour' ? 60 : null
						})
						.returning({ id: service.id })
			)
		);
		return json({ id: made.id }, { status: 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['name', 'unit'], 'service');
		if (refused) return refused;
		throw e;
	}
};
