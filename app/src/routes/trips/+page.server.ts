import { monthOf } from '#lib/format.ts';
import { and, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { townsOf } from '#lib/server/trips.ts';
import { loadCatalogue, valueLegs } from '#lib/server/valuation/load.ts';
import { jobRate, priceOn } from '#lib/server/valuation/pricing.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import type { PageServerLoad } from './$types';

/**
 * Trips for a month, billed or not.
 *
 * A trip is one drive, and its legs are its miles, each handed to the client
 * that caused it -- which is what stops two nearby sites being charged a full
 * round trip each (on the seeded trip, 70 miles for 57 driven). "Every mile
 * assigned" means no leg is left without a client.
 */
export const load: PageServerLoad = async ({ url }) => {
	const asked = url.searchParams.get('month') ?? '';
	const day = businessToday();
	const from = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? `${asked}-01` : `${day.slice(0, 8)}01`;
	const to = Temporal.PlainDate.from(from).add({ months: 1 }).toString();

	const tr = t.trip;
	const u = t.user;

	const found = await db
		.select({
			id: tr.id,
			travelled_on: tr.travelledOn,
			driver: u.name,
			vehicle: t.vehicle.name,
			stops: townsOf(tr.id),
			stop_count: sql<number>`(${db
				.select({ n: count() })
				.from(t.tripStop)
				.where(eq(t.tripStop.tripId, tr.id))})::int`,
			clients: sql<string | null>`(${db
				.select({
					names: sql`string_agg(distinct ${t.entity.name}, ' then ' order by ${t.entity.name})`
				})
				.from(t.tripLeg)
				.innerJoin(t.entity, eq(t.entity.id, t.tripLeg.entityId))
				.where(eq(t.tripLeg.tripId, tr.id))})`
		})
		.from(tr)
		.leftJoin(u, eq(u.id, tr.drivenBy))
		.leftJoin(t.vehicle, eq(t.vehicle.id, tr.vehicleId))
		.where(and(gte(tr.travelledOn, from), lt(tr.travelledOn, to)))
		.orderBy(desc(tr.travelledOn), desc(tr.id));

	const legs = found.length
		? await db
				.select({
					id: t.tripLeg.id,
					tripId: t.tripLeg.tripId,
					serviceId: t.tripLeg.serviceId,
					entityId: t.tripLeg.entityId,
					miles: t.tripLeg.miles,
					travelledOn: t.trip.travelledOn,
					invoiced: sql<boolean>`${t.invoiceLine.invoiceId} is not null`
				})
				.from(t.tripLeg)
				.innerJoin(t.trip, eq(t.trip.id, t.tripLeg.tripId))
				.leftJoin(t.invoiceLine, eq(t.invoiceLine.tripLegId, t.tripLeg.id))
				.where(
					inArray(
						t.tripLeg.tripId,
						found.map((f) => f.id)
					)
				)
		: [];
	const [worth, catalogue, places] = await Promise.all([
		valueLegs(db, legs),
		loadCatalogue(db),
		moneyPlaces()
	]);

	const trips = found.map((f) => {
		const mine = legs.filter((l) => l.tripId === f.id);
		const theirs = mine.filter((l) => l.entityId !== null);
		const miles = sum(mine.map((l) => l.miles));
		const assigned = sum(theirs.map((l) => l.miles));
		return {
			...f,
			legs: mine.length,
			miles: miles.toFixed(2),
			assigned: assigned.toFixed(2),
			// Each leg at its own service's price on the day.
			value: sum(mine.map((l) => worth.get(l.id)?.billed ?? null)).toFixed(places),
			billed: theirs.length > 0 && theirs.every((l) => l.invoiced),
			// Whether every mile driven is some client's.
			balanced: assigned.eq(miles)
		};
	});

	// "The" mileage rate only while one service is charged per mile. With two,
	// a leg's own service says which, and a headline figure would be one of
	// them passed off as both.
	const perMile = (
		await db
			.select({ id: t.service.id })
			.from(t.service)
			.where(and(eq(t.service.unit, 'mile'), eq(t.service.active, true)))
	).map((s) => s.id);
	const rate =
		perMile.length === 1 ? jobRate(priceOn(catalogue.prices, perMile[0], null, day), 1) : null;

	return {
		unbilled: trips.filter((x) => !x.billed),
		billed: trips.filter((x) => x.billed),
		totals: {
			month: monthOf(from),
			miles: sum(legs.map((l) => l.miles)).toFixed(2),
			trips: String(found.length),
			rate: rate?.toString() ?? null
		}
	};
};
