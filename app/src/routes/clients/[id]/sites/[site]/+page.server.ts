import { personalDay, businessToday } from '#lib/server/calendar.ts';
import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

/**
 * One site: what it is, what it charges, who to ask for, and what has happened
 * there.
 *
 * A site is the thing a jobsite rate, a mileage figure and a contact all hang
 * off, and every one of those is
 * edited here -- except the rate, which is CDTFA's and has no field.
 */
export const load: PageServerLoad = async ({ params }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);

	const s = t.site;
	const e = t.entity;
	const [site] = await db
		.select({
			id: s.id,
			entity_id: s.entityId,
			version: sql<string>`${s}.xmin::text`,
			client_slug: e.slug,
			slug: s.slug,
			client: e.name,
			label: s.label,
			display: sql<string>`${s.display}`,
			street: s.street,
			city: s.city,
			region: s.region,
			postcode: s.postcode,
			round_trip_miles: s.roundTripMiles,
			drive_minutes: s.driveMinutes,
			active: s.active,
			rate_pct: s.taxRatePct,
			state_rate_pct: s.stateRatePct,
			district_rate_pct: s.districtRatePct,
			jurisdiction: s.taxJurisdiction,
			tax_area_code: s.taxAreaCode,
			verified_on: s.areaVerifiedOn,
			stale: rateIsStale(s.areaVerifiedOn, businessToday()),
			changes: sql<string>`(${db
				.select({ n: count() })
				.from(t.siteTaxCheck)
				.where(and(eq(t.siteTaxCheck.siteId, s.id), eq(t.siteTaxCheck.changed, true)))})::text`
		})
		.from(s)
		.innerJoin(e, eq(e.id, s.entityId))
		.where(and(eq(s.id, found.id), eq(s.entityId, client.id)));
	if (!site) error(404, 'no such site');

	const [people, elsewhere, checks, [worked]] = await Promise.all([
		db
			.select({
				id: t.contact.id,
				name: t.contact.name,
				email: t.contact.email,
				phone: t.contact.phone,
				is_primary: t.siteContact.isPrimary
			})
			.from(t.siteContact)
			.innerJoin(t.contact, eq(t.contact.id, t.siteContact.contactId))
			.where(eq(t.siteContact.siteId, found.id))
			.orderBy(desc(t.siteContact.isPrimary), asc(t.contact.name)),
		// The client's other people, offered before a new one is typed: creating a
		// second Dana Whitfield because nobody looked first is what a name match
		// cannot undo afterwards.
		db
			.select({ id: t.contact.id, name: t.contact.name })
			.from(t.entityContact)
			.innerJoin(t.contact, eq(t.contact.id, t.entityContact.contactId))
			.where(
				and(
					eq(t.entityContact.entityId, client.id),
					notExists(
						db
							.select({ x: sql`1` })
							.from(t.siteContact)
							.where(
								and(eq(t.siteContact.siteId, found.id), eq(t.siteContact.contactId, t.contact.id))
							)
					)
				)
			)
			.orderBy(asc(t.contact.name)),
		// Every answer CDTFA has given about this address.
		db
			.select({
				id: t.siteTaxCheck.id,
				on: sql<string>`${personalDay(t.siteTaxCheck.checkedAt)}::text`,
				rate_pct: t.siteTaxCheck.ratePct,
				jurisdiction: t.siteTaxCheck.taxJurisdiction,
				changed: t.siteTaxCheck.changed,
				note: t.siteTaxCheck.note
			})
			.from(t.siteTaxCheck)
			.where(eq(t.siteTaxCheck.siteId, found.id))
			.orderBy(desc(t.siteTaxCheck.checkedAt))
			.limit(8),
		db
			.select({
				entries: sql<string>`count(*)::text`,
				hours: sql<string>`coalesce(sum(${t.timeEntry.seconds}) / 3600.0, 0)::numeric(10,2)::text`,
				last: sql<string | null>`max(${t.timeEntry.workedOn})::text`
			})
			.from(t.timeEntry)
			.where(eq(t.timeEntry.siteId, found.id))
	]);

	return { site, people, elsewhere, checks, worked };
};
