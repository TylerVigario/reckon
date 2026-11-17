import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import type { DB } from './db/database.ts';
import { lastWeekBegan } from './calendar.ts';

/**
 * WHAT A PHONE KEEPS OF A PERSON'S OWN WORK for no signal: what they can put
 * right on site, and nothing else (#lib/offline-copy). The list of screens to
 * keep (api/offline) and the copies of the lists that lead to them (All
 * entries, Trips) ask the same question here, so every entry or trip a copy
 * shows opens with no signal, and none is kept that a copy does not show.
 */

/**
 * The time entries the person entered this week and last that are neither
 * billed nor paid: the ones they can change or remove on site. A condition on
 * time_entry, for a query's where: `.where((eb) => keptEntries(eb, me, today,
 * weekStart))`.
 */
export const keptEntries = (
	eb: ExpressionBuilder<DB, 'time_entry'>,
	me: string,
	today: string,
	weekStart: number
): Expression<SqlBool> =>
	eb.and([
		eb('time_entry.created_by', '=', me),
		eb('time_entry.worked_on', '>=', lastWeekBegan(today, weekStart)),
		eb.not(
			eb.exists(
				eb
					.selectFrom('invoice_line as il')
					.select(eb.lit(1).as('one'))
					.whereRef('il.time_entry_id', '=', 'time_entry.id')
			)
		),
		eb.not(
			eb.exists(
				eb
					.selectFrom('person_payment_item as i')
					.select(eb.lit(1).as('one'))
					.whereRef('i.time_entry_id', '=', 'time_entry.id')
			)
		)
	]);

/** How far back a trip is kept: a month's, and the one before it while it is billed. */
export const KEPT_TRIP_DAYS = 60;

/**
 * The trips the person drove in the last KEPT_TRIP_DAYS whose miles are
 * neither billed nor paid: the ones put right on the road. Someone with Full
 * keeps only their own too; anyone else's is office work, done with a signal.
 * A condition on trip, for a query's where: `.where((eb) => keptTrips(eb, me,
 * today))`.
 */
export const keptTrips = (
	eb: ExpressionBuilder<DB, 'trip'>,
	me: string,
	today: string
): Expression<SqlBool> =>
	eb.and([
		eb('trip.driven_by', '=', me),
		eb(
			'trip.travelled_on',
			'>=',
			Temporal.PlainDate.from(today).subtract({ days: KEPT_TRIP_DAYS }).toString()
		),
		eb.not(
			eb.exists(
				eb
					.selectFrom('invoice_line as il')
					.innerJoin('trip_leg as l', 'l.id', 'il.trip_leg_id')
					.select(eb.lit(1).as('one'))
					.whereRef('l.trip_id', '=', 'trip.id')
			)
		),
		eb.not(
			eb.exists(
				eb
					.selectFrom('person_payment_item as i')
					.select(eb.lit(1).as('one'))
					.whereRef('i.trip_id', '=', 'trip.id')
			)
		)
	]);
