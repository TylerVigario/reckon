import { asUser } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { handOver, temporaryPassword } from '#lib/server/handover.ts';
import { parseAll } from '#lib/field-rules.ts';
import { NEW_PERSON_FIELDS } from '#lib/people-fields.ts';
import type { Access } from '#lib/access.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Adds a person: their name, the email they sign in with, which no one else may
 * have, the role they are paid as or none, and what they reach.
 *
 * Answered with a password to hand them, once. Only its hash is kept, so it
 * cannot be shown again, and they choose their own the first time they sign in
 * with it (#lib/server/handover).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const fields = await readFields(request);
	if (!fields)
		return problem(
			'malformed',
			400,
			`Expected { fields: { ${Object.keys(NEW_PERSON_FIELDS).join(', ')} } }.`
		);
	const { values, errors } = parseAll(NEW_PERSON_FIELDS, fields);
	if (Object.keys(errors).length > 0) return refuse(errors);

	const { password, hash } = await temporaryPassword();
	try {
		const id = await asUser(locals.user!.id, async (tx) => {
			const [made] = await tx
				.insert(user)
				.values({
					name: String(values.name),
					email: String(values.email),
					roleId: values.role_id === null ? null : String(values.role_id),
					access: values.access as Access
				})
				.returning({ id: user.id });
			await handOver(tx, made.id, hash);
			return made.id;
		});
		return Response.json(
			{ id, password },
			{ status: 201, headers: { 'cache-control': 'no-store' } }
		);
	} catch (e) {
		if (pgError(e).constraint === 'user_email_key')
			return refuse({ email: 'Someone else signs in with that email.' });
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(NEW_PERSON_FIELDS), 'user');
		if (refused) return refused;
		throw e;
	}
};
