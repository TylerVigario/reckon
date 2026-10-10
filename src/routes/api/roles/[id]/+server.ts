import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { role } from '#lib/server/db/schema/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo, stillReferenced } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { PAYS_AS, parseRoleField, ROLE_FIELDS } from '#lib/people-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Renames a role, or says what it is paid as -- one at a time, as a setting
 * saves. Everybody who holds it, and every rule written against it, follows;
 * what a payment already recorded stays as it was paid.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No role with that id.');
	const fields = await readFields(request);
	const [field] = Object.keys(fields ?? {});
	if (!fields || Object.keys(fields).length !== 1 || !(field in ROLE_FIELDS))
		return problem(
			'malformed',
			400,
			'Expected { fields: { name: value } } or { fields: { pays_as: value } }.'
		);
	const raw = fields[field];
	const parsed = parseRoleField(field, typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ [field]: parsed.why });
	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.update(role)
				.set(
					field === 'name'
						? { name: String(parsed.value) }
						: { paysAs: parsed.value as (typeof PAYS_AS)[number] }
				)
				.where(eq(role.id, params.id))
				.returning({ id: role.id })
		);
		if (changed.length === 0) return problem('notFound', 404, 'No role with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['name'], 'role');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: { [field]: parsed.value } });
};

/**
 * Removes a role nobody holds and no pay rule names. Otherwise the schema
 * refuses it, and the answer says why: taking it away would leave people paid
 * by nothing, or rules paying nobody.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No role with that id.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.delete(role).where(eq(role.id, params.id)).returning({ id: role.id })
		);
		if (gone.length === 0) return problem('notFound', 404, 'No role with that id.');
	} catch (e) {
		if (stillReferenced(e))
			return problem(
				'conflict',
				409,
				'Somebody holds this role, or a pay rule is written against it. Move them, or change the rule, first.'
			);
		throw e;
	}
	return Response.json({ removed: params.id });
};
