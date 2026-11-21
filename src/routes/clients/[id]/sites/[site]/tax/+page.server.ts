import { db } from '#lib/server/db/index.ts';
import { businessDay, businessToday } from '#lib/server/calendar.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import { areaRate, kindRates } from '#lib/server/tax-areas.ts';
import { typedAreas, typesAreasIn } from '#lib/server/typed-areas.ts';
import { kindChoices, taxesByState } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * Where a site has been placed: its latest placements, each in the area its
 * address was found in then and at that area's rate on the day, how -- asked
 * of the authority, or chosen -- and by whom, and which was its first, which
 * moved it from nowhere. Each is dated by the business's day, as Last asked
 * is (#lib/server/calendar).
 *
 * And where a person chooses a site's area -- the business collects in its
 * state, and no authority answers there -- the state's typed areas to choose
 * from (#lib/server/typed-areas). Its rate is on every kind its state taxes,
 * and a kind its area taxes alone says its own.
 */
export const load: PageServerLoad = async ({ params, parent }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);
	const { region } = await db
		.selectFrom('site')
		.select('region')
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();
	const [placements, areas, kinds, taxes, { site }] = await Promise.all([
		db
			.selectFrom('site_placement as k')
			.innerJoin('tax_area as a', 'a.id', 'k.area_id')
			.leftJoin('user as u', 'u.id', 'k.placed_by')
			.select((eb) => {
				const day = businessDay(eb.ref('k.placed_at'));
				return [
					'k.id',
					eb.cast<string>(day, 'text').as('on'),
					'a.name as area',
					// The area's rate on that day, as its pieces then said.
					areaRate(eb.ref('a.id'), day).as('rate_pct'),
					'k.moved',
					'k.way',
					'k.note',
					'u.name as by',
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
			.execute(),
		(await typesAreasIn(db, region)) ? typedAreas(db, region, businessToday()) : null,
		kindChoices(db),
		taxesByState(db),
		parent()
	]);
	const names = Object.fromEntries(kinds.map((k) => [k.id, k.name]));
	return {
		placements,
		areas,
		every: site.pieces.filter((p) => !p.kind),
		byKind: kindRates(site.pieces, taxes[region] ?? [], names)
	};
};
