import { db } from './db/index.ts';
import { businessToday } from './calendar.ts';
import type { Price } from '#lib/rates.ts';
import { jobRate, priceOn } from './valuation/pricing.ts';
import { loadCatalogue } from './valuation/load.ts';
import { team } from './valuation/entries.ts';

/**
 * Every client each service has a price for today, with the rate for a crew of
 * each size a team can be -- one person up to everybody active who holds a
 * role -- worked out by the valuation, the one place a price is resolved, so a
 * page chooses a figure and never computes one.
 */
export async function pricesToday(): Promise<Price[]> {
	const day = businessToday();
	const [catalogue, scopes] = await Promise.all([
		loadCatalogue(db),
		db
			.selectFrom('service_price')
			.select(['service_id', 'entity_id'])
			.distinct()
			.where('effective_from', '<=', day)
			.execute()
	]);
	const heads = Math.max(team(catalogue.people).length, 1);
	return scopes.map(({ service_id, entity_id }) => {
		const p = priceOn(catalogue.prices, service_id, entity_id, day);
		return {
			service_id,
			entity_id,
			byHeads: Array.from({ length: heads + 1 }, (_, n) =>
				n === 0 ? null : (jobRate(p, n)?.toString() ?? null)
			)
		};
	});
}
