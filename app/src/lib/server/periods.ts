import { businessToday } from './calendar.ts';
import { sql } from 'drizzle-orm';
import { fiscalYear as fiscalYearName, monthOf, span } from '#lib/format.ts';
import { db } from './db/index.ts';
import { operator } from './db/schema/index.ts';

export type Period = { start: string; end: string; label: string; spans: string };
type Bounds = { start: string; end: string };

/**
 * The windows every report is cut to.
 *
 * They are measured from the business's today (#lib/server/calendar), so every
 * report agrees about which month it is whoever is looking, and the month
 * arithmetic is Postgres's. What a window is called -- "September 2026",
 * "1 Sept to 30 Sept 2026" -- is written by #lib/format, like every other date
 * a person reads.
 *
 * THE FISCAL YEAR is the operator's own, taken from the month it ends in. It is
 * null when that has not been set: a return cut to a guessed year is worse than
 * one that will not compute, so the screens say what is missing instead.
 *
 * THE MONTH is the last COMPLETE one. Pay and usage are settled after a month
 * closes, and a report that includes a month still being worked reads as
 * finished when it is not -- which is why the one report that shows the month
 * in progress, the retainer meter, says "so far" in its label.
 */
export async function fiscalYear(): Promise<Period | null> {
	const { rows } = await db.execute<Bounds>(sql`
		with o as (select ${operator.fiscalYearEndMonth} as m from ${operator}),
		bounds as (
			select (date_trunc('month', make_date(
			          extract(year from ${businessToday()}::date)::int
			            + case when extract(month from ${businessToday()}::date)::int <= o.m then 0 else 1 end,
			          o.m, 1)) + interval '1 month - 1 day')::date as ends_on
			  from o where o.m is not null
		)
		select (ends_on - interval '1 year' + interval '1 day')::date::text as start,
		       ends_on::text as end
		  from bounds`);
	const b = rows[0];
	return b ? { ...b, label: fiscalYearName(b.start, b.end), spans: span(b.start, b.end) } : null;
}

export async function lastFullMonth(): Promise<Period> {
	const { rows } = await db.execute<Bounds>(sql`
		with m as (select (date_trunc('month', ${businessToday()}::date) - interval '1 month')::date as first_day)
		select first_day::text as start,
		       (first_day + interval '1 month - 1 day')::date::text as end
		  from m`);
	const b = rows[0];
	return { ...b, label: monthOf(b.start), spans: span(b.start, b.end) };
}

/**
 * THIS MONTH, SO FAR -- from the 1st to today. Not settled, and labelled so.
 *
 * A retainer is charged in advance for the month it covers, so its charge is
 * known on the 1st while its usage builds all month. Waiting for the month to
 * close to show that usage hides the only month that is still happening.
 */
export async function thisMonth(): Promise<Period> {
	const { rows } = await db.execute<Bounds>(sql`
		select date_trunc('month', ${businessToday()}::date)::date::text as start,
		       ${businessToday()}::date::text as end`);
	const b = rows[0];
	return { ...b, label: `${monthOf(b.start)} so far`, spans: span(b.start, b.end) };
}
