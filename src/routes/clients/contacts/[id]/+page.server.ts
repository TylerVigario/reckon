import { error } from '@sveltejs/kit';
import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * One contact: who they are, and the clients and sites they act for.
 *
 * This is where a contact's details live; a client and a site name them and
 * link here. Someone with Field reads them, to call or ask for somebody on a
 * job, and not whose invoices go to them (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'no such contact');
	const person = await db
		.selectFrom('contact')
		.select(['id', 'name', 'email', 'phone', 'note'])
		.where('id', '=', params.id)
		.executeTakeFirst();
	if (!person) error(404, 'no such contact');

	const clients = await db
		.selectFrom('entity_contact as ec')
		.innerJoin('entity as e', 'e.id', 'ec.entity_id')
		.select((eb) => [
			'e.slug',
			'e.name',
			'ec.is_primary as bills',
			eb.fn
				.coalesce(
					eb
						.selectFrom('site_contact as sc')
						.innerJoin('site as s', 's.id', 'sc.site_id')
						.select((eb) =>
							eb.fn.agg<string[]>('array_agg', ['s.label']).orderBy('s.label').as('labels')
						)
						.whereRef('sc.contact_id', '=', 'ec.contact_id')
						.whereRef('sc.entity_id', '=', 'ec.entity_id')
						.$asScalar(),
					sql<string[]>`'{}'`
				)
				.as('sites')
		])
		.where('ec.contact_id', '=', person.id)
		.orderBy('e.name')
		.execute();

	const field = fieldOnly(locals);
	return {
		person,
		clients: field ? clients.map((x) => ({ ...x, bills: false })) : clients
	};
};
