import { sql, type Expression } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { fieldOnly } from '#lib/server/mine.ts';
import type { PageServerLoad } from './$types';

/**
 * People, who cross entities and locations both, each opening their own page.
 * Someone with Field reads them, and not whose invoices go to whom
 * (#lib/access).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [contacts, clients] = await Promise.all([
		db
			.selectFrom('contact as c')
			.leftJoin('entity_contact as ec', 'ec.contact_id', 'c.id')
			.leftJoin('entity as e', 'e.id', 'ec.entity_id')
			.leftJoin('site_contact as sc', 'sc.contact_id', 'c.id')
			.leftJoin('site as si', 'si.id', 'sc.site_id')
			.select((eb) => {
				// coalesce, not just array_remove: array_agg over no rows is NULL,
				// and a filtered aggregate matching nothing is exactly that case --
				// a contact who is nobody's primary would hand the page a null to
				// call .includes() on.
				const names = (agg: Expression<string[] | null>) =>
					eb.fn.coalesce(
						eb.fn<string[] | null>('array_remove', [agg, eb.lit(null)]),
						sql<string[]>`'{}'`
					);
				return [
					'c.id',
					'c.name',
					'c.email',
					'c.phone',
					'c.note',
					names(eb.fn.agg<string[] | null>('array_agg', ['e.name']).distinct()).as('clients'),
					names(eb.fn.agg<string[] | null>('array_agg', ['si.display']).distinct()).as('sites'),
					names(
						eb.fn
							.agg<string[] | null>('array_agg', ['e.name'])
							.distinct()
							.filterWhere('ec.is_primary', '=', true)
					).as('primary_for')
				];
			})
			.groupBy('c.id')
			.orderBy('c.name')
			.execute(),
		// For Entities' other tab, counted as the client list counts them.
		db
			.selectFrom('entity')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.executeTakeFirstOrThrow()
	]);

	return {
		contacts: fieldOnly(locals) ? contacts.map((c) => ({ ...c, primary_for: [] })) : contacts,
		counts: { clients: clients.n }
	};
};
