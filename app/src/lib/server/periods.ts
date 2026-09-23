import { sql } from './db';

export type Period = { start: string; end: string; label: string; spans: string };

/**
 * The two windows every report is cut to, computed in Postgres so that a report
 * and the rows behind it agree about where a day falls. `new Date()` on a
 * server running UTC calls a Californian evening tomorrow, and a report that
 * moves an invoice into the next quarter is a filing problem.
 *
 * THE FISCAL YEAR is the operator's own, taken from the month it ends in. It is
 * null when that has not been set: a return cut to a guessed year is worse than
 * one that will not compute, so the screens say what is missing instead.
 *
 * THE MONTH is the last COMPLETE one. Pay and usage are settled after a month
 * closes, and a report that includes a month still being worked reads as
 * finished when it is not.
 */
export async function fiscalYear(): Promise<Period | null> {
	const [row] = await sql<{ start: string; end: string; label: string; spans: string }[]>`
		with o as (select fiscal_year_end_month as m from operator),
		bounds as (
			select (date_trunc('month', make_date(
			          extract(year from current_date)::int
			            + case when extract(month from current_date)::int <= o.m then 0 else 1 end,
			          o.m, 1)) + interval '1 month - 1 day')::date as ends_on
			  from o where o.m is not null
		)
		select (ends_on - interval '1 year' + interval '1 day')::date::text as start,
		       ends_on::text as end,
		       to_char(ends_on - interval '1 year' + interval '1 day', 'FMDD Mon YYYY')
		         || ' to ' || to_char(ends_on, 'FMDD Mon YYYY') as spans,
		       'FY' || to_char(ends_on - interval '1 year' + interval '1 day', 'YYYY')
		            || '–' || to_char(ends_on, 'YY') as label
		  from bounds`;
	return row ?? null;
}

export async function lastFullMonth(): Promise<Period> {
	const [row] = await sql<{ start: string; end: string; label: string; spans: string }[]>`
		with m as (select (date_trunc('month', current_date) - interval '1 month')::date as first_day)
		select first_day::text as start,
		       (first_day + interval '1 month - 1 day')::date::text as end,
		       to_char(first_day, 'FMMonth YYYY') as label,
		       to_char(first_day, 'FMDD Mon') || ' to '
		         || to_char(first_day + interval '1 month - 1 day', 'FMDD Mon YYYY') as spans
		  from m`;
	return row;
}
