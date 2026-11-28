import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { prices } from '#lib/server/catalogue.ts';
import type { PageServerLoad } from './$types';

/**
 * A service's prices: what is in force and what is scheduled, every client's
 * and each client's own, and the agreements that cover it instead, with what
 * each includes -- hours, or how many times of one charged each. What was is
 * its History tab.
 */
export const load: PageServerLoad = async ({ params }) => {
	const [priced, covered, clients] = await Promise.all([
		prices(params.id),
		// The agreements that name this service: for those clients it is not
		// billed by the hour, and the price rows are not what they pay.
		db
			.selectFrom('agreement_service as c')
			.innerJoin('agreement as a', 'a.id', 'c.agreement_id')
			.innerJoin('entity as e', 'e.id', 'a.entity_id')
			.leftJoin('site as s', 's.id', 'a.site_id')
			.select((eb) => [
				'a.id as agreement_id',
				'e.name as who',
				's.display as site',
				'c.allotment',
				eb
					.cast<string | null>(
						eb.cast(
							eb.case().when('c.allotment', '=', 'capped').then(eb.ref('c.included')).end(),
							'numeric(10, 2)'
						),
						'text'
					)
					.as('included')
			])
			.where('c.service_id', '=', params.id)
			.where((eb) => eb.or([eb('a.ends_on', 'is', null), eb('a.ends_on', '>=', businessToday())]))
			.orderBy('e.name')
			.orderBy('s.display', (ob) => ob.nullsFirst())
			.execute(),
		db
			.selectFrom('entity')
			.select(['id', 'name'])
			.where('active', '=', true)
			.orderBy('name')
			.execute()
	]);
	return { prices: priced.filter((p) => p.state !== 'superseded'), covered, clients };
};
