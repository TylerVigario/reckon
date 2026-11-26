import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { siteExemptions, siteKindRates, siteRate } from '#lib/server/tax-registrations.ts';
import { formTerms } from '#lib/server/lines.ts';
import type { PageServerLoad } from './$types';

/**
 * Add a line to a draft started on this phone, before it has arrived. The
 * draft is the phone's to know (#lib/queue), so this is one screen for all of
 * them, kept for no signal, with every client's sites: the page shows the
 * draft's client's.
 */
export const load: PageServerLoad = async () => {
	const [sites, terms] = await Promise.all([
		db
			.selectFrom('site')
			.select((eb) => [
				'id',
				'entity_id',
				'display as label',
				// Its state, and where the business collects there and the site has
				// been placed, its area's rate today on every kind the state taxes and
				// what its pieces for one kind alone add; and its client's exemptions in
				// force there, each with the kinds it covers and nothing of why
				// (#lib/server/tax-registrations).
				'region as state',
				siteRate(
					{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
					businessToday()
				).as('rate_pct'),
				siteKindRates(
					{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
					businessToday()
				).as('kind_rates'),
				siteExemptions({ entity: eb.ref('site.entity_id'), region: eb.ref('site.region') }).as(
					'exempt'
				)
			])
			.where('active', '=', true)
			.orderBy('display')
			.execute(),
		formTerms()
	]);
	return { sites, ...terms };
};
