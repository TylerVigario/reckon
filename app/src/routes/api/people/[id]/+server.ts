import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { asUser } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID } from '$lib/field-rules';
import { parsePersonField } from '$lib/people-fields';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readFields } from '$lib/json';

/**
 * Sets the role a person is paid in, or none. Which pay rules reach them
 * follows from it -- and, until pay is recorded when it is paid, so does what
 * the reports say their unpaid work pays.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const fields = await readFields(request);
	if (!fields || Object.keys(fields).length !== 1 || !('role_id' in fields))
		return problem('malformed', 400, 'Expected { fields: { role_id: value } }.');
	const raw = fields.role_id;
	const parsed = parsePersonField('role_id', typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ role_id: parsed.why });
	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.update(user)
				.set({ roleId: parsed.value as string | null })
				.where(eq(user.id, params.id))
				.returning({ id: user.id })
		);
		if (changed.length === 0) return problem('notFound', 404, 'No person with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['role_id'], 'user');
		if (refused) return refused;
		throw e;
	}
	return json({ saved: { role_id: parsed.value } });
};
