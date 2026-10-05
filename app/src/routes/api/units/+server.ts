import { asUser } from '#lib/server/db/index.ts';
import { unit } from '#lib/server/db/schema/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseAll } from '#lib/field-rules.ts';
import { UNIT_FIELDS } from '#lib/unit-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/** Adds a unit to the operator's own list. A name already on it is refused. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const { values, errors } = parseAll(UNIT_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);
	try {
		const [made] = await asUser(locals.user!.id, (tx) =>
			tx
				.insert(unit)
				.values({
					name: String(values.name),
					short: values.short === null ? null : String(values.short),
					places: Number(values.places)
				})
				.returning({ id: unit.id })
		);
		return Response.json({ id: made.id }, { status: 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(UNIT_FIELDS), 'unit');
		if (refused) return refused;
		throw e;
	}
};
