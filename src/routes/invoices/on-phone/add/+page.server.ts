import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { collectsIn, siteRate } from '#lib/server/tax-registrations.ts';
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
				// Whether the business collects in its state, and its area's rate
				// today where it does and the site has been placed
				// (#lib/server/tax-registrations).
				collectsIn(eb.ref('site.region')).as('collected'),
				siteRate(
					{ region: eb.ref('site.region'), area: eb.ref('site.tax_area_id') },
					businessToday()
				).as('rate_pct')
			])
			.where('active', '=', true)
			.orderBy('display')
			.execute(),
		formTerms()
	]);
	return { sites, ...terms };
};
