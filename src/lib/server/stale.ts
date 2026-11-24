import { sql, type Expression } from 'kysely';
import type { TaxAreaSource } from './db/database.ts';

/**
 * WHEN A SITE'S RATE IS STALE: not known to be right since this quarter began.
 * Rates and boundaries change on the first day of a quarter -- California's
 * districts, and every state of the Streamlined Sales and Use Tax Agreement
 * (s. 304(A)(2), s. 305(A) and (C)) -- so an answer from before then may be
 * last quarter's.
 *
 * A site's rate rests on two answers: that its address is in its area
 * (site.area_verified_on, when it was last placed), and what the area levies
 * (tax_area.confirmed_on). Where an authority answers, the server asks for
 * both on its own -- every area each day and every site each quarter
 * (#lib/server/tax-sync) -- so a stale rate is the server not having reached
 * it. A typed area is confirmed by a person, against the state's own table.
 *
 * Imports nothing of SvelteKit's, so `bin/reckon tax refresh` runs it under
 * plain Node, and the day to judge by is handed in: the business's
 * (#lib/server/calendar's businessToday).
 */

/**
 * The last day a site's rate was known right on both counts, or null for a
 * site in no area. A site in a typed area was chosen into it by a person, and
 * nothing can ask again where it is, so its rate rests on its area's
 * confirmation alone: it stays where it was put until someone moves it.
 */
export const lastConfirmed = (
	placedOn: Expression<string | null>,
	confirmedOn: Expression<string | null>,
	source: Expression<TaxAreaSource | null>
) =>
	sql<string | null>`case when ${source} = 'typed' then ${confirmedOn}
		else least(${placedOn}, ${confirmedOn}) end`;

/** The day this quarter began, as `today` (the business's) falls. */
export const quarterBegan = (today: string) =>
	sql<string>`date_trunc('quarter', ${today}::date)::date`;

/** Whether a rate last confirmed on `lastConfirmed` is stale on `today`. */
export const rateIsStale = (confirmed: Expression<string | null>, today: string) =>
	sql<boolean>`(${confirmed} < ${quarterBegan(today)})`;
