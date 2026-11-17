import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { findClient } from '#lib/server/find.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * A client's Contacts: their people, each opening their own page, where their
 * details are changed, with the sites each is asked for at; and which of them
 * the invoices go to. Someone with Field reads them, to know whom to ask for,
 * and not whose invoices go to whom (#lib/access).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { id } = await findClient(params.id);
	const contacts = await db
		.selectFrom('entity_contact as ec')
		.innerJoin('contact as c', 'c.id', 'ec.contact_id')
		.select((eb) => [
			'c.id',
			'c.name',
			'c.email',
			'c.phone',
			'ec.is_primary as bills',
			eb.fn
				.coalesce(
					eb
						.selectFrom('site_contact as sc')
						.innerJoin('site as s', 's.id', 'sc.site_id')
						.select((eb) =>
							eb.fn.agg<string[]>('array_agg', ['s.label']).orderBy('s.label').as('labels')
						)
						.whereRef('sc.contact_id', '=', 'c.id')
						.whereRef('sc.entity_id', '=', 'ec.entity_id')
						.$asScalar(),
					sql<string[]>`'{}'`
				)
				.as('sites')
		])
		.where('ec.entity_id', '=', id)
		.orderBy('c.name')
		.execute();
	return {
		contacts: fieldOnly(locals) ? contacts.map((x) => ({ ...x, bills: false })) : contacts
	};
};
