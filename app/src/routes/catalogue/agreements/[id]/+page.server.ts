import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Decimal } from '$lib/decimal';
import { db, today as dbToday } from '$lib/server/db';
import * as t from '$lib/server/db/schema';
import { loadAgreements, usedThisMonth } from '$lib/server/valuation/load';
import { hoursOf } from '$lib/server/valuation/misc';
import { UUID } from '$lib/field-rules';
import type { PageServerLoad } from './$types';

/**
 * One agreement -- a client's, or one of its sites' -- what it charges, when it
 * runs, and what it covers of each service, all of it editable here.
 *
 * What each period was charged is shown here; nothing on this screen charges
 * one.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such agreement');

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
			ended: sql<boolean>`coalesce(${t.agreement.endsOn} < current_date, false)`
		})
		.from(t.agreement)
		.innerJoin(t.entity, eq(t.entity.id, t.agreement.entityId))
		.leftJoin(t.site, eq(t.site.id, t.agreement.siteId))
		.where(eq(t.agreement.id, params.id));
	if (!agreement) error(404, 'no such agreement');

	const r = alias(t.role, 'r');
	const u = alias(t.user, 'u');
	const [theirs, services, contacts, rules, periods, today] = await Promise.all([
		loadAgreements(db, [agreement.entity_id]),
		db
			.select({ id: t.service.id, name: t.service.name })
			.from(t.service)
			.where(eq(t.service.active, true))
			.orderBy(asc(t.service.name)),
		db
			.select({ id: t.contact.id, name: t.contact.name })
			.from(t.entityContact)
			.innerJoin(t.contact, eq(t.contact.id, t.entityContact.contactId))
			.where(eq(t.entityContact.entityId, agreement.entity_id))
			.orderBy(asc(t.contact.name)),
		// The rules written for this client alone, in force today: what covered
		// time pays here is one of them. They are edited on the service.
		db
			.selectDistinctOn(
				[t.payRule.serviceId, t.payRule.roleId, t.payRule.userId, t.payRule.paysFor],
				{
					id: t.payRule.id,
					service_id: t.payRule.serviceId,
					service: t.service.name,
					payee: sql<string>`coalesce(${r.name}, ${u.name})`,
					pays_for: t.payRule.paysFor,
					method: t.payRule.method,
					amount: t.payRule.amount
				}
			)
			.from(t.payRule)
			.innerJoin(t.service, eq(t.service.id, t.payRule.serviceId))
			.leftJoin(r, eq(r.id, t.payRule.roleId))
			.leftJoin(u, eq(u.id, t.payRule.userId))
			.where(
				and(
					eq(t.payRule.entityId, agreement.entity_id),
					lte(t.payRule.effectiveFrom, sql`current_date`)
				)
			)
			.orderBy(
				t.payRule.serviceId,
				t.payRule.roleId,
				t.payRule.userId,
				t.payRule.paysFor,
				desc(t.payRule.effectiveFrom)
			),
		db
			.select({
				id: t.agreementPeriod.id,
				period_start: t.agreementPeriod.periodStart,
				period_end: t.agreementPeriod.periodEnd,
				amount: t.agreementPeriod.amount,
				given: t.agreementPeriod.given
			})
			.from(t.agreementPeriod)
			.where(eq(t.agreementPeriod.agreementId, agreement.id))
			.orderBy(desc(t.agreementPeriod.periodStart))
			.limit(12),
		dbToday()
	]);

	// The hours that fell under this agreement: at its site, or for a client's
	// agreement, anywhere a site's own does not reach.
	const used = await usedThisMonth(db, theirs, today);
	const names = new Map(services.map((s) => [s.id, s.name]));
	const missing = theirs
		.find((a) => a.id === agreement.id)!
		.services.filter((s) => !names.has(s.serviceId))
		.map((s) => s.serviceId);
	if (missing.length)
		for (const s of await db
			.select({ id: t.service.id, name: t.service.name })
			.from(t.service)
			.where(inArray(t.service.id, missing)))
			names.set(s.id, s.name);
	const covers = theirs
		.find((a) => a.id === agreement.id)!
		.services.map((s) => ({
			service_id: s.serviceId,
			service: names.get(s.serviceId) ?? '',
			allotment: s.allotment,
			included_hours: s.includedHours,
			overage: s.overage,
			pooled: s.allotment === 'capped' ? Decimal.from(s.includedHours ?? '0').toFixed(2) : null,
			used: hoursOf(used.get(`${agreement.id}:${s.serviceId}`) ?? 0)
		}))
		.sort((x, y) => (x.service < y.service ? -1 : x.service > y.service ? 1 : 0));

	const now = periods.find((p) => p.period_start <= today && today <= p.period_end) ?? null;

	return {
		agreement,
		covers,
		services: services.filter((s) => !covers.some((c) => c.service_id === s.id)),
		allServices: services,
		contacts,
		rules,
		periods,
		now,
		today
	};
};
