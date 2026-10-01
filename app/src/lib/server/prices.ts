import { lte } from 'drizzle-orm';
import { db, today } from './db';
import { servicePrice } from './db/schema';
import type { Price } from '$lib/rates';
import { jobRate, priceOn } from './valuation/pricing';
import { loadCatalogue } from './valuation/load';
import { team } from './valuation/entries';

/**
 * Every client each service has a price for today, with the rate for one person
 * and for the team -- worked out by the valuation, the one place a price is
 * resolved, so a page chooses between the two figures and never computes one.
 * A team is everybody active who holds a role.
 */
export async function pricesToday(): Promise<Price[]> {
	const day = await today();
	const [catalogue, scopes] = await Promise.all([
		loadCatalogue(db),
		db
			.selectDistinct({ serviceId: servicePrice.serviceId, entityId: servicePrice.entityId })
			.from(servicePrice)
			.where(lte(servicePrice.effectiveFrom, day))
	]);
	const heads = Math.max(team(catalogue.people).length, 1);
	return scopes.map(({ serviceId, entityId }) => {
		const p = priceOn(catalogue.prices, serviceId, entityId, day);
		return {
			service_id: serviceId,
			entity_id: entityId,
			one: jobRate(p, 1)?.toString() ?? null,
			team: jobRate(p, heads)?.toString() ?? null
		};
	});
}
