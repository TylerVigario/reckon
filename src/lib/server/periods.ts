import { businessToday } from './calendar.ts';
import { sql } from 'kysely';
import { fiscalYear as fiscalYearName, monthOf, span } from '#lib/format.ts';
import { db } from './db/index.ts';

export type Period = { start: string; end: string; label: string; spans: string };

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
	const today = sql<string>`${businessToday()}::date`;
	const b = await db
		.with('bounds', (qc) =>
			qc
				.selectFrom('operator')
				.where('fiscal_year_end_month', 'is not', null)
				.select((eb) => {
					const m = eb.ref('fiscal_year_end_month');
					const year = sql<number>`extract(year from ${today})::int + ${eb
						.case()
						.when(sql<number>`extract(month from ${today})::int`, '<=', m)
						.then(eb.lit(0))
						.else(eb.lit(1))
						.end()}`;
					return sql<string>`(date_trunc('month', make_date(${year}, ${m}, 1)) + interval '1 month - 1 day')::date`.as(
						'ends_on'
					);
				})
		)
		.selectFrom('bounds')
		.select((eb) => [
			sql<string>`(${eb.ref('ends_on')} - interval '1 year' + interval '1 day')::date::text`.as(
				'start'
			),
			eb.cast<string>('ends_on', 'text').as('end')
		])
		.executeTakeFirst();
	return b ? { ...b, label: fiscalYearName(b.start, b.end), spans: span(b.start, b.end) } : null;
}

export async function lastFullMonth(): Promise<Period> {
	const b = await db
		.with('m', (qc) =>
			qc.selectNoFrom(
				sql<string>`(date_trunc('month', ${businessToday()}::date) - interval '1 month')::date`.as(
					'first_day'
				)
			)
		)
		.selectFrom('m')
		.select((eb) => [
			eb.cast<string>('first_day', 'text').as('start'),
			sql<string>`(${eb.ref('first_day')} + interval '1 month - 1 day')::date::text`.as('end')
		])
		.executeTakeFirstOrThrow();
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
	const today = sql<string>`${businessToday()}::date`;
	const b = await db
		.selectNoFrom((eb) => [
			sql<string>`date_trunc('month', ${today})::date::text`.as('start'),
			eb.cast<string>(today, 'text').as('end')
		])
		.executeTakeFirstOrThrow();
	return { ...b, label: `${monthOf(b.start)} so far`, spans: span(b.start, b.end) };
}
