import { businessToday, personalToday } from '#lib/server/calendar.ts';
import { db } from '#lib/server/db/index.ts';
import { anHourNow } from '#lib/server/reports.ts';
import { prices, rules } from '#lib/server/catalogue.ts';
import { kindChoices } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * What can go on a line, and what each of it is worth -- one row a service,
 * which opens onto the service itself.
 *
 * Money stays a string all the way out; what the business keeps is worked out
 * by the same functions that price and pay an entry -- the valuation's
 * billedAmount and timePay -- so this screen cannot tell a different story from
 * the one an entry tells.
 */
export const load: PageServerLoad = async () => {
	const [services, priced, paying, covered, kept] = await Promise.all([
		db
			.selectFrom('service')
			.select(['id', 'name', 'unit', 'bill_to_nearest_seconds', 'minimum_charge', 'active'])
			.orderBy('active', 'desc')
			.orderBy('name')
			.execute(),

		prices(),
		rules(),

		// A service an agreement names is not billed by the hour for that
		// client. The agreement says so, service by service, and it is joined
		// in here rather than stored twice.
		db
			.selectFrom('agreement_service as c')
			.innerJoin('agreement as a', 'a.id', 'c.agreement_id')
			.innerJoin('entity as e', 'e.id', 'a.entity_id')
			.leftJoin('site as s', 's.id', 'a.site_id')
			.select([
				'c.agreement_id',
				'c.service_id',
				'e.name as who',
				's.display as site',
				'c.allotment',
				'c.overage'
			])
			.where((eb) => eb.or([eb('a.ends_on', 'is', null), eb('a.ends_on', '>=', businessToday())]))
			.orderBy('e.name')
			.orderBy('s.display', (ob) => ob.nullsFirst())
			.execute(),

		// What an hour leaves the business, worked out once for this screen and
		// the pay report alike.
		anHourNow()
	]);

	return {
		// The day a count to take refused figures is started on (#lib/StockOnPhone).
		today: personalToday(),
		// What a change waiting on this phone made a material, by name (#lib/StockOnPhone).
		kinds: await kindChoices(db),
		services: services.map((s) => ({
			...s,
			// What is in force or about to be. What was is on the service's own
			// screen, and its history behind that.
			prices: priced.filter((p) => p.service_id === s.id && p.state !== 'superseded'),
			rules: paying.filter((r) => r.service_id === s.id && r.state !== 'superseded'),
			covered: covered.filter((c) => c.service_id === s.id),
			kept: kept.filter((k) => k.service_id === s.id && k.crew === 'one')
		}))
	};
};
