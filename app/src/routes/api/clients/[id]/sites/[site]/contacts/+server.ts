import { json } from '@sveltejs/kit';
import { asUser, sql } from '$lib/server/db';
import { refuse, refuseIfTheDatabaseSaidSo } from '$lib/server/field-errors';
import { UUID, cap, required } from '$lib/field-rules';
import { lookUpClient, lookUpSite } from '$lib/server/find';
import type { RequestHandler } from './$types';
import { problem } from '$lib/server/problem';
import { readBody, textField } from '$lib/json';

/**
 * Who to ask for at this site.
 *
 * A PERSON IS SHARED; being named here is not. One contact acts for several
 * clients -- which is why contact has no owner -- so this either attaches
 * somebody who already exists or creates a person and attaches them. Creating
 * a second Uriel Paredes because nobody searched first is the failure a name
 * match cannot prevent, so the page offers the client's people first.
 *
 * ATTACHING AT A SITE ATTACHES AT THE CLIENT TOO. Naming somebody at an
 * address says they are that client's person; the composite key in the schema
 * insists on it, and this makes it true rather than reporting a constraint.
 */
const name = required('A name is needed.', cap(120));

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const client = await lookUpClient(params.id);
	if (!client) return problem('notFound', 404, 'No client by that name or id.');
	const found = await lookUpSite(client.id, params.site);
	if (!found) return problem('notFound', 404, 'That client has no such site.');

	const body = await readBody(request);
	const [site] = await sql<
		{ id: string; entity_id: string }[]
	>`select id, entity_id from site where id = ${found.id}`;

	let contactId: string = textField(body, 'contact_id');

	if (!UUID.test(contactId)) {
		const parsed = name(textField(body, 'name'));
		if (!parsed.ok) return refuse({ name: parsed.why });
		const [made] = await sql<{ id: string }[]>`
			insert into contact ${sql({
				name: String(parsed.value),
				email: textField(body, 'email') || null,
				phone: textField(body, 'phone') || null
			})} returning id`;
		contactId = made.id;
	} else {
		const [exists] = await sql`select id from contact where id = ${contactId}`;
		if (!exists) return refuse({ contact_id: 'No such person.' });
	}

	const primary = body?.is_primary === true;

	try {
		await asUser(locals.user!.id, async (tx) => {
			await tx`
				insert into entity_contact (entity_id, contact_id)
				values (${site.entity_id}, ${contactId})
				on conflict do nothing`;
			// One person answers first. Standing the new one up means standing
			// the old one down, in the same transaction as the partial unique
			// index that would otherwise refuse it.
			if (primary) await tx`update site_contact set is_primary = false where site_id = ${site.id}`;
			await tx`
				insert into site_contact (site_id, entity_id, contact_id, is_primary)
				values (${site.id}, ${site.entity_id}, ${contactId}, ${primary})
				on conflict (site_id, contact_id) do update set is_primary = excluded.is_primary`;
		});
	} catch (e) {
		const refused = refuseIfTheDatabaseSaidSo(e, ['contact_id', 'is_primary'], 'site_contact');
		if (refused) return refused;
		throw e;
	}

	return json({ contact_id: contactId }, { status: 201 });
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

	await asUser(
		locals.user!.id,
		(tx) => tx`delete from site_contact where site_id = ${id} and contact_id = ${contactId}`
	);
	return json({ removed: true });
};
