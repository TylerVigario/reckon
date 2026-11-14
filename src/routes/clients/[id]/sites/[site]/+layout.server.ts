import { businessToday } from '#lib/server/calendar.ts';
import { error } from '@sveltejs/kit';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { rateIsStale, STALE_AFTER_DAYS } from '#lib/server/stale.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One site, as each of its tabs heads it (+layout): what it is called, what is
 * charged there and how much has been worked there, and how many people to ask
 * for. Details is where it is and how far; Contacts, who to ask for; Tax, what
 * CDTFA has said of it.
 *
 * A site is the thing a jobsite rate, a mileage figure and a contact all hang
 * off, and every one of those is changed under it -- except the rate, which is
 * CDTFA's and has no field. It is the rate's one home, where CDTFA is asked
 * again. Someone with Field reads it, to work at, and changes nothing
 * (#lib/access).
 */
export const load: LayoutServerLoad = async ({ params }) => {
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
			google_place_id: s.googlePlaceId,
			typed_round_trip_miles: s.typedRoundTripMiles,
			typed_drive_minutes: s.typedDriveMinutes,
			google_round_trip_miles: s.googleRoundTripMiles,
			google_drive_minutes: s.googleDriveMinutes,
			active: s.active,
			rate_pct: s.taxRatePct,
			state_rate_pct: s.stateRatePct,
			district_rate_pct: s.districtRatePct,
			jurisdiction: s.taxJurisdiction,
			tax_area_code: s.taxAreaCode,
			verified_on: s.areaVerifiedOn,
			stale: rateIsStale(s.areaVerifiedOn, businessToday()),
			asked: sql<number>`(${db
				.select({ n: count() })
				.from(t.siteTaxCheck)
				.where(eq(t.siteTaxCheck.siteId, s.id))})::int`
		})
		.from(s)
		.innerJoin(e, eq(e.id, s.entityId))
		.where(and(eq(s.id, found.id), eq(s.entityId, client.id)));
	if (!site) error(404, 'no such site');

	const [[people], [worked]] = await Promise.all([
		db.select({ n: count() }).from(t.siteContact).where(eq(t.siteContact.siteId, found.id)),
		db
			.select({
				entries: sql<string>`count(*)::text`,
				hours: sql<string>`coalesce(sum(${t.timeEntry.seconds}) / 3600.0, 0)::numeric(10,2)::text`,
				last: sql<string | null>`max(${t.timeEntry.workedOn})::text`
			})
			.from(t.timeEntry)
			.where(eq(t.timeEntry.siteId, found.id))
	]);

	return { site, people: people.n, worked, staleAfter: STALE_AFTER_DAYS };
};
