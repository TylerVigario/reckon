import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { contact } from '#lib/server/db/schema/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { CONTACT_FIELDS, parseContactField } from '#lib/contact-fields.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';

type Field = keyof typeof CONTACT_FIELDS;

/**
 * One thing about a contact at a time: their name, email, phone or note.
 *
 * This is the one place a contact's details change. A person is shared
 * between clients (#lib/contact-fields), so a new email here is the email
 * every client and site they act for has, and the one their invoices go to.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No contact with that id.');
	const fields = await readFields(request);
	const names = fields ? Object.keys(fields) : [];
	if (!fields || names.length !== 1 || !(names[0] in CONTACT_FIELDS))
		return problem(
			'malformed',
			400,
			`Expected { fields: { one of ${Object.keys(CONTACT_FIELDS).join(', ')}: value } }.`
		);
	const name = names[0] as Field;

	const raw = fields[name];
	const parsed = parseContactField(name, typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ [name]: parsed.why });

	try {
		const changed = await asUser(locals.user!.id, (tx) =>
			tx
				.update(contact)
				.set({ [name]: parsed.value })
				.where(eq(contact.id, params.id))
				.returning({ id: contact.id })
		);
		if (changed.length === 0) return problem('notFound', 404, 'No contact with that id.');
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, [name], 'contact');
		if (refused) return refused;
		throw e;
	}
	return Response.json({ saved: { [name]: parsed.value } });
};
