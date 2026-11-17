import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { operatorRow } from '#lib/server/operator.ts';
import { loadCatalogue } from '#lib/server/valuation/load.ts';
import { jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import type { PageServerLoad } from './$types';

/**
 * The settings menu: ten screens, each saying what it is set to now -- the
 * business's name, its terms, its tax rules -- so whether something is set up
 * is answered without opening it.
 */
export const load: PageServerLoad = async () => {
	const day = businessToday();
	const [row, connected, units, mileServices, catalogue, vehicles] = await Promise.all([
		operatorRow(),
		db
			.selectFrom('integration')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('connected', '=', true)
			.executeTakeFirstOrThrow(),
		db.selectFrom('unit').select('name').orderBy('name').execute(),
		db
			.selectFrom('service')
			.select('id')
			.where('unit', '=', 'mile')
			.where('active', '=', true)
			.execute(),
		loadCatalogue(db),
		db
			.selectFrom('vehicle')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('retired_on', 'is', null)
			.executeTakeFirstOrThrow()
	]);
	// The mileage rate, when there is exactly one service charged by the mile.
	const mileage =
		mileServices.length === 1
			? (jobRate(priceOn(catalogue.prices, mileServices[0].id, null, day), 1)?.toString() ?? null)
			: null;

	return {
		operator: row,
		counts: {
			mileage,
			vehicles: vehicles.n,
			units: units.map((u) => u.name),
			integrations: connected.n
		}
	};
};
