import { asUser } from '#lib/server/db/index.ts';
import { vehicle } from '#lib/server/db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseAll } from '#lib/field-rules.ts';
import { VEHICLE_FIELDS } from '#lib/vehicle-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/** Adds a vehicle: what it is called, and whose it is -- a person, or the business. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const { values, errors } = parseAll(VEHICLE_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);
	try {
		const [made] = await asUser(locals.user!.id, (tx) =>
			tx
				.insert(vehicle)
				.values({
					name: String(values.name),
					ownerId: values.owner_id === null ? null : String(values.owner_id)
				})
				.returning({ id: vehicle.id })
		);
		return Response.json({ id: made.id }, { status: 201 });
	} catch (e) {
		if (pgError(e).constraint === 'vehicle_owner_id_fkey')
			return refuse({ owner_id: 'That person is not here any more.' });
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(VEHICLE_FIELDS), 'vehicle');
		if (refused) return refused;
		throw e;
	}
};
