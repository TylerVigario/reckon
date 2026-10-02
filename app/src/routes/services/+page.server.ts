import { asc, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { agreement, agreementService, entity, service, site } from '#lib/server/db/schema/index.ts';
import { anHourNow } from '#lib/server/reports.ts';
import { prices, rules } from '#lib/server/catalogue.ts';
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
			.select({
				id: service.id,
				name: service.name,
				unit: service.unit,
				bill_to_nearest_seconds: service.billToNearestSeconds,
				minimum_charge: service.minimumCharge,
				active: service.active
			})
			.from(service)
			.orderBy(desc(service.active), asc(service.name)),

		prices(),
		rules(),

		// A service an agreement names is not billed by the hour for that
		// client. The agreement says so, service by service, and it is joined
		// in here rather than stored twice.
		db
			.select({
				agreement_id: agreementService.agreementId,
				service_id: agreementService.serviceId,
				who: entity.name,
				site: site.display,
				allotment: agreementService.allotment,
				hours: agreementService.includedHours,
				overage: agreementService.overage
			})
			.from(agreementService)
			.innerJoin(agreement, eq(agreement.id, agreementService.agreementId))
			.innerJoin(entity, eq(entity.id, agreement.entityId))
			.leftJoin(site, eq(site.id, agreement.siteId))
			.where(or(isNull(agreement.endsOn), gte(agreement.endsOn, sql`current_date`)))
			.orderBy(asc(entity.name), sql`${site.display} nulls first`),

		// What an hour leaves the business, worked out once for this screen and
		// the pay report alike.
		anHourNow()
	]);

	return {
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
