import { asUser } from '#lib/server/db/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo, stillReferenced } from '#lib/server/field-errors.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { UUID } from '#lib/field-rules.ts';
import { parseVehicleChange, VEHICLE_CHANGES } from '#lib/vehicle-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Renames a vehicle, or retires it -- from today -- or puts it back in use.
 * Whose it is never changes (0024): one that changes hands is retired and added
 * again, so the trips already driven in it pay who they paid.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No vehicle with that id.');
	const fields = await readFields(request);
	const names = fields ? Object.keys(fields) : [];
	if (!fields || names.length === 0 || names.some((n) => !(n in VEHICLE_CHANGES)))
		return problem('malformed', 400, 'Expected { fields: { name or retired: value } }.');

	const row: Record<string, string | boolean | null> = {};
	const errors: Record<string, string> = {};
	for (const name of names) {
		const raw = fields[name];
		const parsed = parseVehicleChange(
			name,
			typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
				? String(raw)
				: ''
		);
		if (parsed.ok) row[name] = parsed.value as string | boolean | null;
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length > 0) return refuse(errors);

	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.updateTable('vehicle')
				.set((eb) => ({
					...('name' in row ? { name: String(row.name) } : {}),
					// Retired again keeps the day it was first.
					...('retired' in row
						? {
								retired_on: row.retired
									? eb.fn.coalesce('retired_on', eb.cast<string>(eb.val(businessToday()), 'date'))
									: null
							}
						: {})
				}))
				.where('id', '=', params.id)
				.returning('id')
				.execute()
		);
		if (changed.length === 0) return problem('notFound', 404, 'No vehicle with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, names, 'vehicle');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: row });
};

/**
 * Removes a vehicle no trip was driven in. One that was is retired instead: the
 * trips keep it, and the schema refuses to take it from them.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No vehicle with that id.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.deleteFrom('vehicle').where('id', '=', params.id).returning('id').execute()
		);
		if (gone.length === 0) return problem('notFound', 404, 'No vehicle with that id.');
	} catch (e) {
		if (stillReferenced(e))
			return problem('conflict', 409, 'Trips were driven in this vehicle. Retire it instead.');
		throw e;
	}
	return Response.json({ removed: params.id });
};
