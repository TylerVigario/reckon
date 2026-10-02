import { and, asc, desc, eq, gte, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Ratio, sum, sumMoney } from '#lib/decimal.ts';
import { db, today } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { theTeam } from '#lib/server/choices.ts';
import { entryColumns, valueEntries, valueLegs } from '#lib/server/valuation/load.ts';
import type { PageServerLoad } from './$types';

/**
 * Work done and not yet asked for.
 *
 * Today's tiles say how much and roughly how old. This says which -- because
 * the thing a reader does about an ageing figure is find the entry behind it,
 * and a bucket cannot be chased.
 *
 * Oldest first, always. The order is the argument: the top row is the one that
 * should already have gone out.
 *
 * TIME AND MILEAGE ARE PRICED THE SAME WAY, by the valuation: at
 * what the service was worth on the day it was worked, the client's own price
 * before every client's, rounded to the service's increment and never below its
 * minimum. That is the rule an invoice line will use when it is drawn, so this
 * screen and the invoice it becomes cannot disagree. Pricing it at today's rate
 * would quietly re-price August.
 *
 * AN HOUR A RETAINER COVERS IS NOT HERE. The retainer has charged for it, so
 * there is nothing to ask for; only what falls past its allotment is.
 */
export const load: PageServerLoad = async () => {
	const day = await today();
	const u = alias(t.user, 'u');
	const notOnAnInvoice = (
		column: typeof t.invoiceLine.timeEntryId | typeof t.invoiceLine.tripLegId,
		id: typeof t.timeEntry.id | typeof t.tripLeg.id
	) =>
		notExists(
			db
				.select({ x: sql`1` })
				.from(t.invoiceLine)
				.where(eq(column, id))
		);
	const lastMonth = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 2, 1))
		.toISOString()
		.slice(0, 10);

	const [entries, legs, given, [operator], team] = await Promise.all([
		db
			.select({
				...entryColumns,
				who: t.entity.name,
				service: t.service.name,
				workedByName: u.name,
				site: t.site.display
			})
			.from(t.timeEntry)
			.innerJoin(t.service, eq(t.service.id, t.timeEntry.serviceId))
			.innerJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
			.leftJoin(u, eq(u.id, t.timeEntry.workedBy))
			.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
			.where(
				and(
					eq(t.timeEntry.billable, true),
					notOnAnInvoice(t.invoiceLine.timeEntryId, t.timeEntry.id)
				)
			)
			.orderBy(asc(t.timeEntry.workedOn), asc(t.entity.name)),
		db
			.select({
				id: t.tripLeg.id,
				tripId: t.tripLeg.tripId,
				serviceId: t.tripLeg.serviceId,
				entityId: t.tripLeg.entityId,
				miles: t.tripLeg.miles,
				travelledOn: t.trip.travelledOn
			})
			.from(t.tripLeg)
			.innerJoin(t.trip, eq(t.trip.id, t.tripLeg.tripId))
			.where(
				and(isNotNull(t.tripLeg.entityId), notOnAnInvoice(t.invoiceLine.tripLegId, t.tripLeg.id))
			),
		// Not billable, and still worth counting. An hour given away is a
		// decision, and a decision nobody can see was never made.
		db
			.select({
				id: t.timeEntry.id,
				service: t.service.name,
				who: t.entity.name,
				worked_by: u.name,
				worked_on: t.timeEntry.workedOn,
				site: t.site.display,
				minutes: t.timeEntry.minutes
			})
			.from(t.timeEntry)
			.innerJoin(t.service, eq(t.service.id, t.timeEntry.serviceId))
			.leftJoin(t.entity, eq(t.entity.id, t.timeEntry.entityId))
			.leftJoin(u, eq(u.id, t.timeEntry.workedBy))
			.leftJoin(t.site, eq(t.site.id, t.timeEntry.siteId))
			.where(and(eq(t.timeEntry.billable, false), gte(t.timeEntry.workedOn, lastMonth)))
			.orderBy(desc(t.timeEntry.workedOn)),
		db.select({ days: t.operator.ageingAlertDays }).from(t.operator),
		// A team entry records no one person -- the constraint forbids it,
		// because the entry is the whole team's. So the names come from the
		// team itself rather than from the entry, and the row can still say who
		// was there.
		theTeam()
	]);
	const [worth, legWorth] = await Promise.all([valueEntries(db, entries), valueLegs(db, legs)]);
	const alertDays = operator?.days ?? 30;
	const daysSince = (d: string) =>
		Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
	const hours = (minutes: number) => Ratio.of(minutes).div(60).round(4).toFixed(4);

	const work = entries.flatMap((e) => {
		const w = worth.get(e.id)!;
		// The hours still to be asked for: a retainer has charged for any it
		// covered.
		if (w.coveredMinutes !== null && w.coveredMinutes >= e.minutes) return [];
		return [
			{
				id: e.id,
				who: e.who,
				service: e.service,
				worked_by: e.workedByName,
				crew: e.crew,
				worked_on: e.workedOn,
				site: e.site,
				hours: hours(e.minutes - (w.coveredMinutes ?? 0)),
				worth: w.billed?.toFixed(2) ?? null,
				heads: w.heads,
				days: daysSince(e.workedOn)
			}
		];
	});

	// Mileage by the day it was driven. One drive can carry legs for several
	// clients, and two drives on one day are one morning's driving -- so the
	// day is the row, and the trip screen is where it comes apart.
	const days = [...new Set(legs.map((l) => l.travelledOn))].sort();
	const places = days.length
		? await db
				.select({
					day: t.trip.travelledOn,
					place: sql<string>`coalesce(${t.site.city}, ${t.site.label}, ${t.tripStop.address})`
				})
				.from(t.tripStop)
				.innerJoin(t.trip, eq(t.trip.id, t.tripStop.tripId))
				.leftJoin(t.site, eq(t.site.id, t.tripStop.siteId))
				.where(inArray(t.trip.travelledOn, days))
		: [];
	const mileage = days.map((d) => {
		const mine = legs.filter((l) => l.travelledOn === d);
		const worths = mine.map((l) => legWorth.get(l.id)?.billed ?? null).filter((x) => x !== null);
		const named = [
			...new Set(places.filter((p) => p.day === d && p.place !== null).map((p) => p.place))
		].sort();
		return {
			travelled_on: d,
			trips: new Set(mine.map((l) => l.tripId)).size,
			miles: sum(mine.map((l) => l.miles)).toFixed(2),
			worth: worths.length ? sum(worths).toFixed(2) : null,
			places: named.length ? named.join(' and ') : null,
			days: daysSince(d)
		};
	});

	const total = sumMoney([...work, ...mileage].map((r) => r.worth));
	const overdue =
		work.filter((w) => w.days > alertDays).length +
		mileage.filter((m) => m.days > alertDays).length;

	return {
		work,
		mileage,
		given: given.map(({ minutes, ...g }) => ({ ...g, hours: hours(minutes) })),
		alertDays,
		total,
		overdue,
		team: team.map((p) => p.name)
	};
};
