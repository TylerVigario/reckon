import { and, eq, gte, sql } from 'drizzle-orm';
import * as t from './db/schema/index.ts';
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
 * billed nor paid: the ones they can change or remove on site.
 */
export const keptEntries = (me: string, today: string, weekStart: number) =>
	and(
		eq(t.timeEntry.createdBy, me),
		gte(t.timeEntry.workedOn, lastWeekBegan(today, weekStart)),
		sql`not exists (select 1 from ${t.invoiceLine} il where il.time_entry_id = ${t.timeEntry.id})`,
		sql`not exists (select 1 from ${t.personPaymentItem} i where i.time_entry_id = ${t.timeEntry.id})`
	);

/** How far back a trip is kept: a month's, and the one before it while it is billed. */
export const KEPT_TRIP_DAYS = 60;

/**
 * The trips the person drove in the last KEPT_TRIP_DAYS whose miles are
 * neither billed nor paid: the ones put right on the road. Someone with Full
 * keeps only their own too; anyone else's is office work, done with a signal.
 */
export const keptTrips = (me: string, today: string) =>
	and(
		eq(t.trip.drivenBy, me),
		gte(
			t.trip.travelledOn,
			Temporal.PlainDate.from(today).subtract({ days: KEPT_TRIP_DAYS }).toString()
		),
		sql`not exists (select 1 from ${t.invoiceLine} il join ${t.tripLeg} l on l.id = il.trip_leg_id
		                 where l.trip_id = ${t.trip.id})`,
		sql`not exists (select 1 from ${t.personPaymentItem} i where i.trip_id = ${t.trip.id})`
	);
