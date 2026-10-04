/**
 * How a figure or a date is written, in one place.
 *
 * Every page writing its own formatter is how an absent figure reads as "—"
 * on one screen and "$NaN" on the next, and how short months, long months and
 * whether to print the year come to depend on which screen you are looking at.
 * So there is one of each, here.
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
 * it. Components call money() from #lib/money.svelte, which supplies it.
 */
const moneyFormats = new Map<string, Intl.NumberFormat>();
export function formatMoney(v: string | number | null | undefined, currency = 'USD'): string {
	if (v === null || v === undefined || v === '') return ABSENT;
	let f = moneyFormats.get(currency);
	if (!f)
		moneyFormats.set(
			currency,
			(f = new Intl.NumberFormat('en-US', { style: 'currency', currency }))
		);
	return f.format(Number(v));
}

/** A rate, to three places, which is how CDTFA publishes them. */
export function pct(v: string | number | null | undefined, places = 3): string {
	if (v === null || v === undefined || v === '') return ABSENT;
	return `${Number(v).toFixed(places)}%`;
}

/**
 * DATES AND MOMENTS, two different things (#26).
 *
 * A calendar date is the string "2026-09-17", end to end: what Postgres
 * writes, what the API carries, and what Temporal.PlainDate prints. It is
 * drawn by handing its own year, month and day to a formatter set to UTC, so
 * neither the server's zone nor the phone's can move it a day.
 *
 * A moment -- when a timer started, when a row was written -- is stored and
 * sent in UTC, and drawn on the person's own clock: the zone on their user
 * record (#lib/zone.svelte), the same on every device they use. Two people in
 * two zones each see the moment on their own clock.
 *
 * Built-ins only. Temporal says all this more directly, but Safari, and so
 * every browser on an iPhone, does not have it yet, and the server's Node
 * gets it with Node 26. A polyfill would put 20-56 KB on every phone to save
 * a few lines here. Because a date is already Temporal's own string, moving
 * to it later changes this file and nothing that calls it.
 *
 * A formatter is built once per shape and kept: making an Intl.DateTimeFormat
 * costs far more than using one, and these run for every row of a list.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale} ${JSON.stringify(options)}`;
	let f = formatters.get(key);
	if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, options)));
	return f;
}

/** The date as the UTC midnight it names: a fixed point no zone moves, read back in UTC. */
function utc(iso: string): number {
	const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

const onTheDay = (iso: string, options: Intl.DateTimeFormatOptions) =>
	formatter('en-GB', { ...options, timeZone: 'UTC' }).format(utc(iso));

/** "17 Sept" -- for a date inside a period the screen has already named. */
export function day(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return onTheDay(iso, { day: 'numeric', month: 'short' });
}

/** "17 Sept 2026" -- where the year is not obvious from the context. */
export function dated(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return onTheDay(iso, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Thursday, 17 September 2026" -- a screen whose whole subject is one day. */
export function fullDay(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return onTheDay(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** "September 2026" -- a month, as a heading. */
export function monthOf(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return onTheDay(iso, { month: 'long', year: 'numeric' });
}

/**
 * The date it is, in that zone, as "2026-09-17". What a phone uses to date
 * work, so a timer stopped at 11 pm in California is dated that day wherever
 * the phone's own clock happens to be set.
 */
export function todayIn(zone: string, at: number = Date.now()): string {
	const parts = formatter('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(at);
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

/** "Pacific Time" -- a zone, as a person calls it, from its Postgres name. */
export function zoneName(zone: string): string {
	try {
		return (
			formatter('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
				.formatToParts(Date.now())
				.find((p) => p.type === 'timeZoneName')?.value ?? zone
		);
	} catch {
		return zone;
	}
}

/** "09:21" -- a moment, on the person's clock. */
export function clock(at: number | string | Date, zone: string): string {
	return formatter('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(
		new Date(at)
	);
}

/** "17 Sept 2026" -- the date of a moment, on the person's clock. */
export function datedAt(at: number | string | Date, zone: string): string {
	return formatter('en-GB', {
		timeZone: zone,
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(new Date(at));
}

/** Hours to four places, the precision an invoice line bills at. */
export function hours(v: string | number | null | undefined): string {
	if (v === null || v === undefined || v === '') return ABSENT;
	return `${Number(v).toFixed(4)} h`;
}

/**
 * How finely a service bills time, from service.bill_to_nearest_seconds:
 * "to the minute", "to the nearest 15 minutes". Null bills the time exactly.
 */
export function increment(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return 'the exact time';
	const unit = (n: number, one: string) =>
		n === 1 ? `to the ${one}` : `to the nearest ${n} ${one}s`;
	if (seconds % 3600 === 0) return unit(seconds / 3600, 'hour');
	if (seconds % 60 === 0) return unit(seconds / 60, 'minute');
	return unit(seconds, 'second');
}
