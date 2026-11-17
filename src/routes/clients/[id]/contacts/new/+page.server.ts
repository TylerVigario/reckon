import { db } from '#lib/server/db/index.ts';
import { findClient } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

/** Adding a contact to a client: the client, and who its invoices go to now. */
export const load: PageServerLoad = async ({ params }) => {
	const { id } = await findClient(params.id);
	const client = await db
		.selectFrom('entity')
		.select(['slug', 'name'])
		.where('id', '=', id)
		.executeTakeFirstOrThrow();
	const bills = await db
		.selectFrom('entity_contact as ec')
		.innerJoin('contact as c', 'c.id', 'ec.contact_id')
		.select('c.name')
		.where('ec.entity_id', '=', id)
		.where('ec.is_primary', '=', true)
		.executeTakeFirst();
	return { client, bills: bills?.name ?? null };
};
