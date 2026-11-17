import { asUser } from '#lib/server/db/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseAll } from '#lib/field-rules.ts';
import { PAYS_AS, ROLE_FIELDS } from '#lib/people-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Adds a role to the operator's own list, with what it is paid as. A name
 * already on it is refused.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields)
		return problem('malformed', 400, 'Expected { fields: { name: value, pays_as: value } }.');
	const { values, errors } = parseAll(ROLE_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);
	try {
		const made = await asUser(locals.user!.id, (tx) =>
			tx
				.insertInto('role')
				.values({
					name: String(values.name),
					pays_as: values.pays_as as (typeof PAYS_AS)[number]
				})
				.returning('id')
				.executeTakeFirstOrThrow()
		);
		return Response.json({ id: made.id }, { status: 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['name'], 'role');
		if (refused) return refused;
		throw e;
	}
};
