import { db } from '#lib/server/db/index.ts';
import { businessDay } from '#lib/server/calendar.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import { areaRate } from '#lib/server/tax-areas.ts';
import type { PageServerLoad } from './$types';

/**
 * Where a site has been placed: its latest placements, each in the area its
 * address was found in then and at that area's rate on the day, and which was
 * its first, which moved it from nowhere. Each is dated by the business's day,
 * as Last asked is (#lib/server/calendar).
 */
export const load: PageServerLoad = async ({ params }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);
	const placements = await db
		.selectFrom('site_placement as k')
		.innerJoin('tax_area as a', 'a.id', 'k.area_id')
		.select((eb) => {
			const day = businessDay(eb.ref('k.placed_at'));
			return [
				'k.id',
				eb.cast<string>(day, 'text').as('on'),
				'a.name as area',
				// The area's rate on that day, as its pieces then said.
				areaRate(eb.ref('a.id'), day).as('rate_pct'),
				'k.moved',
				'k.note',
				eb(
					eb.fn.agg<number>('row_number').over((ob) => ob.orderBy('k.placed_at').orderBy('k.id')),
					'=',
					eb.lit(1)
				)
					.$castTo<boolean>()
					.as('first')
			];
		})
		.where('k.site_id', '=', found.id)
		.orderBy('k.placed_at', 'desc')
		.orderBy('k.id', 'desc')
		.limit(8)
		.execute();
	return { placements };
};
