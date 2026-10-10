import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { integration, service, unit, user, vehicle } from '#lib/server/db/schema/index.ts';
import { operatorRow } from '#lib/server/operator.ts';
import { loadCatalogue } from '#lib/server/valuation/load.ts';
import { jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import type { PageServerLoad } from './$types';

/**
 * The settings menu: seven screens, each saying what it is set to now -- the
 * business's name, its terms, its tax rules -- so whether something is set up
 * is answered without opening it.
 */
export const load: PageServerLoad = async () => {
	const day = businessToday();
	const [row, [people], [connected], units, mileServices, catalogue, [vehicles]] =
		await Promise.all([
			operatorRow(),
			db.select({ n: count() }).from(user).where(eq(user.active, true)),
			db.select({ n: count() }).from(integration).where(eq(integration.connected, true)),
			db.select({ name: unit.name }).from(unit).orderBy(asc(unit.name)),
			db
				.select({ id: service.id })
				.from(service)
				.where(and(eq(service.unit, 'mile'), eq(service.active, true))),
			loadCatalogue(db),
			db.select({ n: count() }).from(vehicle).where(isNull(vehicle.retiredOn))
		]);
	// The mileage rate, when there is exactly one service charged by the mile.
	const mileage =
		mileServices.length === 1
			? (jobRate(priceOn(catalogue.prices, mileServices[0].id, null, day), 1)?.toString() ?? null)
			: null;

	return {
		operator: row,
		counts: {
			people: people.n,
			mileage,
			vehicles: vehicles.n,
			units: units.map((u) => u.name),
			integrations: connected.n
		}
	};
};
