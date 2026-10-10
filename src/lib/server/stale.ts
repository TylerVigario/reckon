import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * scripts/refresh-tax-rates.mjs imports this file under plain Node, to judge
 * staleness by the same rule as the screens. So nothing here may reach a $app
 * module, which exists only inside SvelteKit -- #lib/server/calendar does --
 * and the day to judge by is handed in.
 */

/** An answer nobody has re-asked about in this many days is stale: not wrong, but not known to be right. */
export const STALE_AFTER_DAYS = 90;

/**
 * Whether a site's rate is stale: CDTFA was last asked more than
 * STALE_AFTER_DAYS before `today`, which is the business's
 * (#lib/server/calendar's businessToday). Every site has a rate -- stale says
 * the answer is old, not that there is none.
 */
export const rateIsStale = (areaVerifiedOn: AnyPgColumn | SQL.Aliased | SQL, today: string) =>
	sql<boolean>`(${areaVerifiedOn} < ${today}::date - ${STALE_AFTER_DAYS}::int)`;
