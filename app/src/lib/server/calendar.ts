import { getRequestEvent } from '$app/server';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { todayIn } from '#lib/format.ts';

/**
 * WHOSE TODAY.
 *
 * The database and the server work in UTC: every moment is stored as
 * timestamptz, and every connection is opened in UTC whatever the host's
 * default is (./db). But "today" is always somebody's, and a request that needs
 * one says whose:
 *
 *   the PERSON'S -- their own timesheet, the day a new entry starts on, the
 *   latest day they may record work for, and any moment shown to them as a
 *   date. From the time zone on their user record.
 *
 *   the BUSINESS'S -- whether an invoice is overdue, how long work has waited,
 *   where a report's month begins, which price or rule is in force, when a rate
 *   was last confirmed. From the operator's zone, so everyone gets the same
 *   answer about the business.
 *
 * A calendar date that is stored -- worked on, issued, due -- is neither: it was
 * decided once, by whoever recorded it, and means the same day to everyone.
 *
 * Both zones are found once per request (hooks.server.ts) and read here from
 * the request in hand, so a query anywhere in a load or an action asks the same
 * question the same way. Outside a request -- a script, a job with nobody
 * looking -- neither is known here, and UTC is used; such work says its zone
 * outright.
 */
function zones(): { zone: string; businessZone: string } | null {
	try {
		return getRequestEvent().locals;
	} catch {
		return null;
	}
}

export const personalZone = (): string => zones()?.zone ?? 'UTC';
export const businessZone = (): string => zones()?.businessZone ?? 'UTC';

/** Today on the person's clock, as "2026-09-17". Bind into SQL as ${personalToday()}::date. */
export const personalToday = (): string => todayIn(personalZone());

/** Today on the business's clock, as "2026-09-17". Bind into SQL as ${businessToday()}::date. */
export const businessToday = (): string => todayIn(businessZone());

/** The day a moment fell on for the person, in SQL: a timestamptz in, a date out. */
export const personalDay = (moment: SQLWrapper) =>
	sql`((${moment}) at time zone ${personalZone()})::date`;

/** The day a moment fell on for the business, in SQL. */
export const businessDay = (moment: SQLWrapper) =>
	sql`((${moment}) at time zone ${businessZone()})::date`;
