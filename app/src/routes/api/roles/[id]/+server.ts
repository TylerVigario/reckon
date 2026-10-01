import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { asUser } from '$lib/server/db';
import { role } from '$lib/server/db/schema';
import { refuse, refuseIfTheDatabaseSaidSo, stillReferenced } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { parseRoleField } from '$lib/people-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/** Renames a role. Everybody who holds it, and every rule written against it, follows. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No role with that id.');
	const fields = await readFields(request);
	if (!fields || Object.keys(fields).length !== 1 || !('name' in fields))
		return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const raw = fields.name;
	const parsed = parseRoleField('name', typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ name: parsed.why });
	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.update(role)
				.set({ name: String(parsed.value) })
				.where(eq(role.id, params.id))
				.returning({ id: role.id })
		);
		if (changed.length === 0) return problem('notFound', 404, 'No role with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['name'], 'role');
		if (refused) return refused;
		throw e;
	}
	return json({ saved: { name: parsed.value } });
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
	return json({ removed: params.id });
};
