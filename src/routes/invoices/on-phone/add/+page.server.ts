import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { siteExemptions, siteKindRates, siteRate } from '#lib/server/tax-registrations.ts';
import { formTerms } from '#lib/server/lines.ts';
import type { PageServerLoad } from './$types';

/**
 * A line on this phone, for a draft the server cannot open for it: one started
 * here that has not arrived yet, to add to, or one that has gone out, to fix a
 * line it refused, which then goes on the client's next draft. Each is the
 * phone's to know (#lib/queue), so this is one screen for all of them, kept for
 * no signal, with every client's sites -- as Clients shows them, and the kinds
 * each client is exempt from at each, without why -- and the page shows its
 * client's.
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
