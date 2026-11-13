import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { prices } from '#lib/server/catalogue.ts';
import type { PageServerLoad } from './$types';

/**
 * A service's prices: what is in force and what is scheduled, every client's
 * and each client's own, and the agreements that cover it instead. What was
 * is its History tab.
 */
export const load: PageServerLoad = async ({ params }) => {
	const [priced, covered, clients] = await Promise.all([
		prices(params.id),
		// The agreements that name this service: for those clients it is not
		// billed by the hour, and the price rows are not what they pay.
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
					eq(t.agreementService.serviceId, params.id),
					or(isNull(t.agreement.endsOn), gte(t.agreement.endsOn, sql`${businessToday()}::date`))
				)
			)
			.orderBy(asc(t.entity.name), sql`${t.site.display} nulls first`),
		db
			.select({ id: t.entity.id, name: t.entity.name })
			.from(t.entity)
			.where(eq(t.entity.active, true))
			.orderBy(asc(t.entity.name))
	]);
	return { prices: priced.filter((p) => p.state !== 'superseded'), covered, clients };
};
