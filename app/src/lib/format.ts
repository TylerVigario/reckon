/**
 * How a figure or a date is written, in one place.
 *
 * Before this there were 24 copies of `money` in seven shapes and 16 of `day`
 * in eleven. Three of the money copies did not handle a null at all, so
 * whether an absent figure read as "—" or as "$NaN" depended on which screen
 * you were looking at; the date copies disagreed about short months, long
 * months and whether to print the year. None of that was a decision anybody
 * made -- it is what happens when every page writes its own.
 *
 * MONEY IS NEVER PARSED INTO A NUMBER BEFORE IT GETS HERE. It arrives as a
 * string from Postgres because it is NUMERIC, and the only place it becomes a
 * Number is the last step before it is shown.
 */

const ABSENT = '—';

/**
 * A figure in a stated currency, or a dash when there is not one.
 *
 * The currency is an argument because it is data -- operator.currency is a
 * setting, and a literal 'USD' here would be the same fault as a hardcoded tax
 * rate: a value with a source of truth, duplicated where nobody would look for
 * it. Components call money() from $lib/money.svelte, which supplies it.
 */
export function formatMoney(v: string | number | null | undefined, currency = 'USD'): string {
	if (v === null || v === undefined || v === '') return ABSENT;
	return Number(v).toLocaleString('en-US', { style: 'currency', currency });
}

/** A rate, to three places, which is how CDTFA publishes them. */
export function pct(v: string | number | null | undefined, places = 3): string {
	if (v === null || v === undefined || v === '') return ABSENT;
	return `${Number(v).toFixed(places)}%`;
}

/**
 * NOON, NOT MIDNIGHT. A date column comes back as "2026-09-17"; handing that
 * to Date() parses it as UTC midnight, which west of Greenwich is the evening
 * before -- so a date renders as the previous day for eight hours of every
 * day. Noon is far enough from both edges that no timezone can move it.
 */
const at = (iso: string) => new Date(`${iso}T12:00:00`);

/** "17 Sept" -- for a date inside a period the screen has already named. */
export function day(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return at(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "17 Sept 2026" -- where the year is not obvious from the context. */
export function dated(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return at(iso).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** "Thursday, 17 September 2026" -- a screen whose whole subject is one day. */
export function fullDay(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return at(iso).toLocaleDateString('en-GB', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

/** Hours to four places, the precision an invoice line bills at. */
export function hours(v: string | number | null | undefined): string {
	if (v === null || v === undefined || v === '') return ABSENT;
	return `${Number(v).toFixed(4)} h`;
}
