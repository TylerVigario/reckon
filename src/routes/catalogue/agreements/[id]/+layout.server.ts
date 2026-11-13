import { error } from '@sveltejs/kit';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One agreement as a record -- a client's, or one of its sites' -- what it
 * charges and when it runs, what this period came to, and whether anything
 * has been charged under it: what its head and its menu say, whichever tab is
 * open. Each tab loads its own part.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such agreement');
	const today = businessToday();

	const [agreement] = await db
		.select({
			id: t.agreement.id,
			entity_id: t.agreement.entityId,
			client: t.entity.name,
			client_slug: t.entity.slug,
			site: t.site.display,
			price: t.agreement.price,
			billing_interval: t.agreement.billingInterval,
			billing_anchor_day: t.agreement.billingAnchorDay,
			starts_on: t.agreement.startsOn,
			ends_on: t.agreement.endsOn,
			final_period_proration: t.agreement.finalPeriodProration,
			contact_id: t.agreement.contactId,
			ended: sql<boolean>`coalesce(${t.agreement.endsOn} < ${today}::date, false)`
		})
		.from(t.agreement)
		.innerJoin(t.entity, eq(t.entity.id, t.agreement.entityId))
		.leftJoin(t.site, eq(t.site.id, t.agreement.siteId))
		.where(eq(t.agreement.id, params.id));
	if (!agreement) error(404, 'no such agreement');

	const [[charged], [now]] = await Promise.all([
		db
			.select({ n: count() })
			.from(t.agreementPeriod)
			.where(eq(t.agreementPeriod.agreementId, agreement.id)),
		// This period, if it has been charged: what it came to, or given freely.
		db
			.select({ amount: t.agreementPeriod.amount, given: t.agreementPeriod.given })
			.from(t.agreementPeriod)
			.where(
				and(
					eq(t.agreementPeriod.agreementId, agreement.id),
					lte(t.agreementPeriod.periodStart, sql`${today}::date`),
					gte(t.agreementPeriod.periodEnd, sql`${today}::date`)
				)
			)
	]);
	return { agreement, charged: charged.n, now: now ?? null, today };
};
