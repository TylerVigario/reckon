import { db } from '#lib/server/db/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { UUID, parseAll } from '#lib/field-rules.ts';
import { CONTACT_FIELDS } from '#lib/contact-fields.ts';
import { textField } from '#lib/json.ts';

/**
 * The person a client or a site is given: somebody who already exists, by
 * `contact_id`, or somebody new, made from the name, email, phone and note
 * sent -- each held to the same rules as changing them later
 * (#lib/contact-fields).
 *
 * A person is made before they are attached, outside the attaching
 * transaction: a person attached to nobody is harmless, and is listed on
 * Contacts to be found again.
 */
export async function personFrom(
	body: Record<string, unknown> | null
): Promise<{ id: string } | { refused: Response }> {
	const given = textField(body, 'contact_id');
	if (UUID.test(given)) {
		const exists = await db
			.selectFrom('contact')
			.select('id')
			.where('id', '=', given)
			.executeTakeFirst();
		return exists ? { id: exists.id } : { refused: refuse({ contact_id: 'No such person.' }) };
	}

	const { values, errors } = parseAll(CONTACT_FIELDS, body ?? {});
	if (Object.keys(errors).length > 0) return { refused: refuse(errors) };
	const made = await db
		.insertInto('contact')
		.values({
			name: String(values.name),
			email: (values.email as string | null) ?? null,
			phone: (values.phone as string | null) ?? null,
			note: (values.note as string | null) ?? null
		})
		.returning('id')
		.executeTakeFirstOrThrow();
	return { id: made.id };
}
