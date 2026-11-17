import { expressionBuilder, type Expression } from 'kysely';
import { Ratio, sum, sumMoney } from '#lib/decimal.ts';
import type { DB } from '#lib/server/db/database.ts';
import { db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { crewNames } from '#lib/server/choices.ts';
import { entryColumns, valueEntries, valueLegs } from '#lib/server/valuation/load.ts';
import { moneyPlaces } from '#lib/server/business.ts';
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
	const day = businessToday();
	const notOnAnInvoice = (
		column: 'invoice_line.time_entry_id' | 'invoice_line.trip_leg_id',
		id: Expression<string>
	) => {
		const eb = expressionBuilder<DB>();
		return eb.not(
			eb.exists(
				eb
					.selectFrom('invoice_line')
					.select((eb) => eb.lit(1).as('x'))
					.where(column, '=', id)
			)
		);
	};
	const lastMonth = Temporal.PlainDate.from(day)
		.with({ day: 1 })
		.subtract({ months: 1 })
		.toString();

	const [entries, legs, given, operator] = await Promise.all([
		db
			.selectFrom('time_entry')
			.innerJoin('service', 'service.id', 'time_entry.service_id')
			.innerJoin('entity', 'entity.id', 'time_entry.entity_id')
			.leftJoin('user as u', 'u.id', 'time_entry.worked_by')
			.leftJoin('site', 'site.id', 'time_entry.site_id')
			.select((eb) => [
				...entryColumns,
				'entity.name as who',
				'service.name as service',
				'u.name as workedByName',
				// A team entry names its crew (0023), and the row says who was there.
				crewNames(eb.ref('time_entry.id')).as('teamNames'),
				'site.display as site'
			])
			.where('time_entry.billable', '=', true)
			.where((eb) => notOnAnInvoice('invoice_line.time_entry_id', eb.ref('time_entry.id')))
			.orderBy('time_entry.worked_on')
			.orderBy('entity.name')
			.execute(),
		db
			.selectFrom('trip_leg')
			.innerJoin('trip', 'trip.id', 'trip_leg.trip_id')
			.select([
				'trip_leg.id',
				'trip_leg.trip_id as tripId',
				'trip_leg.service_id as serviceId',
				'trip_leg.entity_id as entityId',
				'trip_leg.miles',
				'trip.travelled_on as travelledOn'
			])
			.where('trip_leg.entity_id', 'is not', null)
			.where((eb) => notOnAnInvoice('invoice_line.trip_leg_id', eb.ref('trip_leg.id')))
			.execute(),
		// Not billable, and still worth counting. An hour given away is a
		// decision, and a decision nobody can see was never made.
		db
			.selectFrom('time_entry')
			.innerJoin('service', 'service.id', 'time_entry.service_id')
			.leftJoin('entity', 'entity.id', 'time_entry.entity_id')
			.leftJoin('user as u', 'u.id', 'time_entry.worked_by')
			.leftJoin('site', 'site.id', 'time_entry.site_id')
			.select([
				'time_entry.id',
				'service.name as service',
				'entity.name as who',
				'u.name as worked_by',
				'time_entry.worked_on',
				'site.display as site',
				'time_entry.seconds'
			])
			.where('time_entry.billable', '=', false)
			.where('time_entry.worked_on', '>=', lastMonth)
			.orderBy('time_entry.worked_on', 'desc')
			.execute(),
		db.selectFrom('operator').select('ageing_alert_days as days').executeTakeFirst()
	]);
	const [worth, legWorth, places] = await Promise.all([
		valueEntries(db, entries),
		valueLegs(db, legs),
		moneyPlaces()
	]);
	const alertDays = operator?.days ?? 30;
	const daysSince = (d: string) => Temporal.PlainDate.from(d).until(day).days;
	const hours = (seconds: number) => Ratio.of(seconds).div(3600).round(4).toFixed(4);

	const work = entries.flatMap((e) => {
		const w = worth.get(e.id)!;
		// The hours still to be asked for: a retainer has charged for any it
		// covered.
		if (w.coveredSeconds !== null && w.coveredSeconds >= e.seconds) return [];
		return [
			{
				id: e.id,
				who: e.who,
				service: e.service,
				worked_by: e.workedByName,
				crew: e.crew,
				crew_names: e.teamNames,
				worked_on: e.workedOn,
				site: e.site,
				hours: hours(e.seconds - (w.coveredSeconds ?? 0)),
				worth: w.billed?.toString() ?? null,
				heads: w.heads,
				days: daysSince(e.workedOn)
			}
		];
	});

	// Mileage by the day it was driven. One drive can carry legs for several
	// clients, and two drives on one day are one morning's driving -- so the
	// day is the row, and the trip screen is where it comes apart.
	const days = [...new Set(legs.map((l) => l.travelledOn))].sort();
	const placeNames = days.length
		? await db
				.selectFrom('trip_stop')
				.innerJoin('trip', 'trip.id', 'trip_stop.trip_id')
				.leftJoin('site', 'site.id', 'trip_stop.site_id')
				.select((eb) => [
					'trip.travelled_on as day',
					eb.fn.coalesce('site.city', 'site.label', 'trip_stop.address').as('place')
				])
				.where('trip.travelled_on', '=', (eb) => eb.fn.any(eb.val(days)))
				.execute()
		: [];
	const mileage = days.map((d) => {
		const mine = legs.filter((l) => l.travelledOn === d);
		const worths = mine.map((l) => legWorth.get(l.id)?.billed ?? null).filter((x) => x !== null);
		const named = [
			...new Set(placeNames.filter((p) => p.day === d && p.place !== null).map((p) => p.place))
		].sort();
		return {
			travelled_on: d,
			trips: new Set(mine.map((l) => l.tripId)).size,
			miles: sum(mine.map((l) => l.miles)).toFixed(2),
			worth: worths.length ? sum(worths).toFixed(places) : null,
			places: named.length ? named.join(' and ') : null,
			days: daysSince(d)
		};
	});

	const total = sumMoney(
		[...work, ...mileage].map((r) => r.worth),
		places
	);
	const overdue =
		work.filter((w) => w.days > alertDays).length +
		mileage.filter((m) => m.days > alertDays).length;

	return {
		work,
		mileage,
		given: given.map(({ seconds, ...g }) => ({ ...g, hours: hours(seconds) })),
		alertDays,
		total,
		overdue
	};
};
