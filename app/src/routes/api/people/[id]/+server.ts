import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { parsePersonField } from '#lib/people-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';
import { knownZone } from '#lib/server/zones.ts';

/**
 * One thing about a person at a time: the role they are paid in, or the time
 * zone they keep.
 *
 * The role, or none: which pay rules reach them follows from it -- and, until
 * pay is recorded when it is paid, so does what the reports say their unpaid
 * work pays.
 *
 * The zone is stored in Postgres's spelling, and only if Postgres knows it --
 * moments are turned into days with it -- or as null, which follows the
 * business's zone.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No person with that id.');
	const fields = await readFields(request);
	const names = fields ? Object.keys(fields) : [];
	if (!fields || names.length !== 1 || !['role_id', 'timezone'].includes(names[0]))
		return problem('malformed', 400, 'Expected { fields: { role_id or timezone: value } }.');
	const name = names[0];
	const raw = fields[name];
	const parsed = parsePersonField(name, typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ [name]: parsed.why });

	let value = parsed.value as string | null;
	if (name === 'timezone' && value !== null) {
		value = await knownZone(value);
		if (value === null) return refuse({ timezone: 'The database does not know that time zone.' });
	}

	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.update(user)
				.set(name === 'role_id' ? { roleId: value } : { timezone: value })
				.where(eq(user.id, params.id))
				.returning({ id: user.id })
		);
		if (changed.length === 0) return problem('notFound', 404, 'No person with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, [name], 'user');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: { [name]: value } });
};
