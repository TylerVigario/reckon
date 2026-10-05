import { and, count, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { integration, service, unit, user } from '#lib/server/db/schema/index.ts';
import { operatorRow } from '#lib/server/operator.ts';
import { loadCatalogue } from '#lib/server/valuation/load.ts';
import { jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import type { PageServerLoad } from './$types';

/**
 * The settings menu: seven screens, each with the figure that answers "is this
 * set up" without opening it.
 */
export const load: PageServerLoad = async () => {
	const day = businessToday();
	const [row, [people], [connected], [units], mileServices, catalogue] = await Promise.all([
		operatorRow(),
		db.select({ n: count() }).from(user).where(eq(user.active, true)),
		db.select({ n: count() }).from(integration).where(eq(integration.connected, true)),
		db.select({ n: count() }).from(unit),
		db
			.select({ id: service.id })
			.from(service)
			.where(and(eq(service.unit, 'mile'), eq(service.active, true))),
		loadCatalogue(db)
	]);
	// The mileage rate, when there is exactly one service charged by the mile.
	const mileage =
		mileServices.length === 1
			? (jobRate(priceOn(catalogue.prices, mileServices[0].id, null, day), 1)?.toString() ?? null)
			: null;

	return {
		operator: row,
		counts: {
			people: String(people.n),
			mileage,
			units: String(units.n),
			integrations: String(connected.n)
		}
	};
};
