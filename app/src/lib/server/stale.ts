import { businessToday } from './calendar.ts';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** An answer nobody has re-asked about in this many days is stale: not wrong, but not known to be right. */
export const STALE_AFTER_DAYS = 90;

/**
 * Whether a site's rate is stale: CDTFA was last asked more than
 * STALE_AFTER_DAYS ago, by the database's calendar. Every site has a rate --
 * stale says the answer is old, not that there is none.
 */
export const rateIsStale = (areaVerifiedOn: AnyPgColumn | SQL.Aliased | SQL) =>
	sql<boolean>`(${areaVerifiedOn} < ${businessToday()}::date - ${STALE_AFTER_DAYS}::int)`;
