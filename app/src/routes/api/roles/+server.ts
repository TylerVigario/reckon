import { json } from '@sveltejs/kit';
import { asUser } from '#lib/server/db/index.ts';
import { role } from '#lib/server/db/schema/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { parseAll } from '#lib/field-rules.ts';
import { ROLE_FIELDS } from '#lib/people-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/** Adds a role to the operator's own list. A name already on it is refused. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const { values, errors } = parseAll(ROLE_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);
	try {
		const [made] = await asUser(locals.user!.id, (tx) =>
			tx
				.insert(role)
				.values({ name: String(values.name) })
				.returning({ id: role.id })
		);
		return json({ id: made.id }, { status: 201 });
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['name'], 'role');
		if (refused) return refused;
		throw e;
	}
};
