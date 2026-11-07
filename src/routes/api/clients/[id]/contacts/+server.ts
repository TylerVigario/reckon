import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { entityContact } from '#lib/server/db/schema/index.ts';
import { refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { lookUpClient } from '#lib/server/find.ts';
import { personFrom } from '#lib/server/contacts.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readBody } from '#lib/json.ts';

/**
 * A client's people, and which of them its invoices go to.
 *
 * Adds somebody new, or names somebody who already exists (#lib/server/contacts).
 * With `is_primary`, they are who the invoices go to: the one before is stood
 * down in the same transaction, since the database holds a client to one
 * (entity_one_primary_contact). Without it, nobody is stood down -- adding a
 * second person does not take the invoices from the first.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');

	const body = await readBody(request);
	const person = await personFrom(body);
	if ('refused' in person) return person.refused;
	const primary = body?.is_primary === true;

	try {
		await asUser(locals.user!.id, async (tx) => {
			if (primary)
				await tx
					.update(entityContact)
					.set({ isPrimary: false })
					.where(eq(entityContact.entityId, client.id));
			const attach = tx
				.insert(entityContact)
				.values({ entityId: client.id, contactId: person.id, isPrimary: primary });
			await (primary
				? attach.onConflictDoUpdate({
						target: [entityContact.entityId, entityContact.contactId],
						set: { isPrimary: true }
					})
				: attach.onConflictDoNothing());
		});
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['contact_id', 'is_primary'], 'entity_contact');
		if (refused) return refused;
		throw e;
	}

	return Response.json({ contact_id: person.id }, { status: 201 });
};
