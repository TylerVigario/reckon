import { sql, type Expression } from 'kysely';

/**
 * WHEN A SITE'S RATE IS STALE: not known to be right since this quarter began.
 * California's rates and district boundaries change on the first day of a
 * quarter, so an answer from before then may be last quarter's.
 *
 * A site's rate rests on two answers: that its address is in its area
 * (site.area_verified_on, when it was last placed), and what the area levies
 * (tax_area.confirmed_on). The server asks for both on its own -- every area
 * each day and every site each quarter (#lib/server/tax-sync) -- so a stale
 * rate is the server not having reached the authority.
 *
 * Imports nothing of SvelteKit's, so scripts/refresh-tax-rates.mjs runs it
 * under plain Node, and the day to judge by is handed in: the business's
 * (#lib/server/calendar's businessToday).
 */

/** The last day a site's rate was known right on both counts. */
export const lastConfirmed = (placedOn: Expression<string>, confirmedOn: Expression<string>) =>
	sql<string>`least(${placedOn}, ${confirmedOn})`;

/** The day this quarter began, as `today` (the business's) falls. */
export const quarterBegan = (today: string) =>
	sql<string>`date_trunc('quarter', ${today}::date)::date`;

/** Whether a rate last confirmed on `lastConfirmed` is stale on `today`. */
export const rateIsStale = (confirmed: Expression<string>, today: string) =>
	sql<boolean>`(${confirmed} < ${quarterBegan(today)})`;
