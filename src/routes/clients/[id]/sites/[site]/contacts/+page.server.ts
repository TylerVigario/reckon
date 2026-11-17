import { db } from '#lib/server/db/index.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * Who to ask for at a site, the one who answers first heading them; and, for
 * someone who can add one, the client's other people, offered before a new
 * one is typed.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);

	const [people, elsewhere] = await Promise.all([
		db
			.selectFrom('site_contact as sc')
			.innerJoin('contact as c', 'c.id', 'sc.contact_id')
			.select(['c.id', 'c.name', 'c.email', 'c.phone', 'sc.is_primary'])
			.where('sc.site_id', '=', found.id)
			.orderBy('sc.is_primary', 'desc')
			.orderBy('c.name')
			.execute(),
		// The client's other people, offered before a new one is typed: creating a
		// second Dana Whitfield because nobody looked first is what a name match
		// cannot undo afterwards.
		fieldOnly(locals)
			? []
			: db
					.selectFrom('entity_contact as ec')
					.innerJoin('contact as c', 'c.id', 'ec.contact_id')
					.select(['c.id', 'c.name'])
					.where('ec.entity_id', '=', client.id)
					.where((eb) =>
						eb.not(
							eb.exists(
								eb
									.selectFrom('site_contact as sc')
									.select(eb.lit(1).as('x'))
									.where('sc.site_id', '=', found.id)
									.whereRef('sc.contact_id', '=', 'c.id')
							)
						)
					)
					.orderBy('c.name')
					.execute()
	]);

	return { contacts: people, elsewhere };
};
