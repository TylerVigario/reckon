import { asUser } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import { pgError, refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { tell } from '#lib/server/email.ts';
import { cannotSend, issue, unsentBecause } from '#lib/server/links.ts';
import { invitation } from '#lib/server/notices.js';
import { parseAll } from '#lib/field-rules.ts';
import { NEW_PERSON_FIELDS } from '#lib/people-fields.ts';
import type { Access } from '#lib/access.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

/**
 * Adds a person -- their name, the email they sign in with, which no one else
 * may have, the role they are paid as or none, and what they reach -- and
 * invites them: an email with a link to choose their own password, good once
 * for 24 hours (#lib/server/links). Whoever adds them never sees a password or
 * the link, so cannot choose one for them (ASVS 5.0 6.4.6). Nobody is added
 * while reckon cannot send it.
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
	const missing = cannotSend();
	if (missing) return problem('emailUnset', 409, unsentBecause(missing));

	const me = locals.user!;
	try {
		const made = await asUser(me.id, async (tx) => {
			const [person] = await tx
				.insert(user)
				.values({
					name: String(values.name),
					email: String(values.email),
					roleId: values.role_id === null ? null : String(values.role_id),
					access: values.access as Access
				})
				.returning({ id: user.id });
			const sent = await issue(tx, person.id, 'invite', me.id);
			await tell(
				tx,
				person.id,
				(them, business) => invitation(them, business, { by: me.name, ...sent }),
				sent.until
			);
			return { id: person.id, sent_to: sent.to, until: sent.until };
		});
		return Response.json(made, { status: 201 });
	} catch (e) {
		if (pgError(e).constraint === 'user_email_key')
			return refuse({ email: 'Someone else signs in with that email.' });
		const refused = refuseIfTheDatabaseSaidSo(e, Object.keys(NEW_PERSON_FIELDS), 'user');
		if (refused) return refused;
		throw e;
	}
};
