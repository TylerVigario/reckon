import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db, today as dbToday } from '$lib/server/db';
import * as t from '$lib/server/db/schema';
import { UUID } from '$lib/field-rules';
import { prices, rules } from '$lib/server/catalogue';
import { anHourNow } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

/**
 * One service: what it is, what it charges, whom it pays -- and each of those
 * editable here.
 *
 * What is in force and what is scheduled are shown. What was is the service's
 * history, a tap away, so this screen says what is true now.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such service');

	const [service] = await db
		.select({
			id: t.service.id,
			name: t.service.name,
			unit: t.service.unit,
			time_tracked: t.service.timeTracked,
			taxable: t.service.taxable,
			active: t.service.active,
			bill_to_nearest_seconds: t.service.billToNearestSeconds,
			minimum_charge: t.service.minimumCharge
		})
		.from(t.service)
		.where(eq(t.service.id, params.id));
	if (!service) error(404, 'no such service');

	const holders = sql`(${db
		.select({ n: count() })
		.from(t.user)
		.where(and(eq(t.user.roleId, t.role.id), eq(t.user.active, true)))})`;
	const uses = (table: typeof t.timeEntry | typeof t.tripLeg | typeof t.agreementService) =>
		db.select({ n: count() }).from(table).where(eq(table.serviceId, service.id));
	const [
		priced,
		paying,
		covered,
		hour,
		roles,
		people,
		clients,
		today,
		[entries],
		[legs],
		[agreements]
	] = await Promise.all([
		prices(service.id),
		rules(service.id),
		// The agreements that name this service: for those clients it is not
		// billed by the hour, and the price rows above are not what they pay.
		db
			.select({
				agreement_id: t.agreement.id,
				who: t.entity.name,
				site: t.site.display,
				allotment: t.agreementService.allotment,
				hours: sql<
					string | null
				>`(case when ${t.agreementService.allotment} = 'capped' then ${t.agreementService.includedHours} end)::numeric(10,2)::text`
			})
			.from(t.agreementService)
			.innerJoin(t.agreement, eq(t.agreement.id, t.agreementService.agreementId))
			.innerJoin(t.entity, eq(t.entity.id, t.agreement.entityId))
			.leftJoin(t.site, eq(t.site.id, t.agreement.siteId))
			.where(
				and(
					eq(t.agreementService.serviceId, service.id),
					or(isNull(t.agreement.endsOn), gte(t.agreement.endsOn, sql`current_date`))
				)
			)
			.orderBy(asc(t.entity.name), sql`${t.site.display} nulls first`),
		anHourNow(),
		// The role people hold first, so a new rule starts on the one in use.
		db
			.select({ id: t.role.id, name: t.role.name })
			.from(t.role)
			.orderBy(desc(holders), asc(t.role.name)),
		db
			.select({ id: t.user.id, name: t.user.name })
			.from(t.user)
			.where(eq(t.user.active, true))
			.orderBy(asc(t.user.name)),
		db
			.select({ id: t.entity.id, name: t.entity.name })
			.from(t.entity)
			.where(eq(t.entity.active, true))
			.orderBy(asc(t.entity.name)),
		dbToday(),
		// What would stop it being deleted: the same three things the schema
		// refuses a delete over. Its own prices and rules do not count -- they
		// go with it.
		uses(t.timeEntry),
		uses(t.tripLeg),
		uses(t.agreementService)
	]);
	const used = { entries: entries.n, legs: legs.n, agreements: agreements.n };

	return {
		service,
		today,
		prices: priced.filter((p) => p.state !== 'superseded'),
		rules: paying.filter((r) => r.state !== 'superseded'),
		earlier:
			priced.filter((p) => p.state === 'superseded').length +
			paying.filter((r) => r.state === 'superseded').length,
		covered,
		hour: hour.filter((h) => h.service_id === service.id),
		roles,
		people,
		clients,
		used
	};
};
