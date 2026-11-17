import { asUser, db } from '#lib/server/db/index.ts';
import { refuse, refuseIfTheDatabaseSaidSo } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { lookUpClient, lookUpSite } from '#lib/server/find.ts';
import { personFrom } from '#lib/server/contacts.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';
import { readBody, textField } from '#lib/json.ts';

/**
 * Who to ask for at this site.
 *
 * A PERSON IS SHARED; being named here is not. One contact acts for several
 * clients -- which is why contact has no owner -- so this either attaches
 * somebody who already exists or creates a person and attaches them. Creating
 * a second Dana Whitfield because nobody searched first is the failure a name
 * match cannot prevent, so the page offers the client's people first.
 *
 * ATTACHING AT A SITE ATTACHES AT THE CLIENT TOO. Naming somebody at an
 * address says they are that client's person; the composite key in the schema
 * insists on it, and this makes it true rather than reporting a constraint.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 404, 'That client has no such site.');

	const body = await readBody(request);
	const site = await db
		.selectFrom('site')
		.select(['id', 'entity_id'])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();

	const person = await personFrom(body);
	if ('refused' in person) return person.refused;
	const contactId = person.id;

	const primary = body?.is_primary === true;

	try {
		await asUser(locals.user!.id, async (tx) => {
			await tx
				.insertInto('entity_contact')
				.values({ entity_id: site.entity_id, contact_id: contactId })
				.onConflict((oc) => oc.doNothing())
				.execute();
			// One person answers first. Standing the new one up means standing
			// the old one down, in the same transaction as the partial unique
			// index that would otherwise refuse it.
			if (primary)
				await tx
					.updateTable('site_contact')
					.set({ is_primary: false })
					.where('site_id', '=', site.id)
					.execute();
			await tx
				.insertInto('site_contact')
				.values({
					site_id: site.id,
					entity_id: site.entity_id,
					contact_id: contactId,
					is_primary: primary
				})
				.onConflict((oc) =>
					oc.columns(['site_id', 'contact_id']).doUpdateSet({ is_primary: primary })
				)
				.execute();
		});
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['contact_id', 'is_primary'], 'site_contact');
		if (refused) return refused;
		throw e;
	}

	return Response.json({ contact_id: contactId }, { status: 201 });
};

/** Takes somebody off this site. They stay the client's contact. */
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 404, 'That client has no such site.');
	const id = found.id;
	const body = await readBody(request);
	const contactId = textField(body, 'contact_id');
	if (!UUID.test(contactId)) return refuse({ contact_id: 'Which person?' });

	await asUser(locals.user!.id, (tx) =>
		tx
			.deleteFrom('site_contact')
			.where('site_id', '=', id)
			.where('contact_id', '=', contactId)
			.execute()
	);
	return Response.json({ removed: true });
};
