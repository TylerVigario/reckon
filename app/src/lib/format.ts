/**
 * How a figure or a date is written: one vocabulary, in one place.
 *
 * Every page writing its own formatter is how an absent figure reads as "—"
 * on one screen and "$NaN" on the next, how a rate is "7.250%" here and
 * "7.250" there, and how short months, long months and whether to print the
 * year come to depend on which screen you are looking at. So each way a
 * figure appears has a name here, and pages use the names. Nothing else calls
 * toFixed, toLocaleString or Intl to write something for a person to read.
 * The same functions run on the server and in the browser.
 *
 * FROM THE EXACT STRING. Money, rates and quantities arrive as strings --
 * Postgres NUMERIC, or Decimal's own toFixed -- and are handed to Intl as
 * strings, which it formats exactly. None passes through a JavaScript number
 * on the way, so none is rounded by a float before it is rounded on purpose:
 * 7.2505 to three places is 7.251, where a float makes it 7.250.
 *
 * The locale is fixed here for now -- dates in British English, numbers in US
 * English -- and becomes a setting; this file is the only one that changes.
 */
import { Decimal, Ratio } from './decimal.ts';

const DATES = 'en-GB';
const NUMBERS = 'en-US';

const ABSENT = '—';

/** What a figure arrives as: NUMERIC's string, or a number for a count. */
type Figure = string | number | null | undefined;
const absent = (v: Figure): v is null | undefined | '' => v === null || v === undefined || v === '';

/** A figure as Intl takes it exactly: its own decimal string, never a float. */
const exact = (v: string | number) => String(v) as `${number}`;

/**
 * Made once per shape and kept: making an Intl formatter costs far more than
 * using one, and these run for every row of a list.
 */
const kept = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
	let f = kept.get(key) as T | undefined;
	if (f === undefined) kept.set(key, (f = make()));
	return f;
}
const numbers = (options: Intl.NumberFormatOptions) =>
	once(`n ${JSON.stringify(options)}`, () => new Intl.NumberFormat(NUMBERS, options));
const dates = (locale: string, options: Intl.DateTimeFormatOptions) =>
	once(`d ${locale} ${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options));

// ---------------------------------------------------------------- money --

/**
 * A figure in a stated currency, or a dash when there is not one.
 *
 * The currency is an argument because it is data -- operator.currency is a
 * setting, and a literal 'USD' here would be the same fault as a hardcoded tax
 * rate. Components call money() from #lib/money.svelte, which supplies it.
 */
export function formatMoney(v: Figure, currency = 'USD'): string {
	if (absent(v)) return ABSENT;
	return numbers({ style: 'currency', currency }).format(exact(v));
}

// --------------------------------------------------------------- figures --

/** A plain figure to a fixed number of places, ungrouped: "0.3720". */
export function fixed(v: Figure, places: number): string {
	if (absent(v)) return ABSENT;
	return numbers({
		minimumFractionDigits: places,
		maximumFractionDigits: places,
		useGrouping: false
	}).format(exact(v));
}

/** A count on an invoice line, to as many as four places and no more: "2.5", "1,200". */
export function quantity(v: Figure): string {
	if (absent(v)) return ABSENT;
	return numbers({ maximumFractionDigits: 4 }).format(exact(v));
}

/** A tax rate, to three places, which is how CDTFA publishes them: "7.750%". */
export function pct(v: Figure, places = 3): string {
	if (absent(v)) return ABSENT;
	return `${fixed(v, places)}%`;
}

/** A markup or a share, to as many as four places: "25%", "33.33%". A tax rate is pct. */
export function percent(v: Figure): string {
	if (absent(v)) return ABSENT;
	return `${quantity(v)}%`;
}

/**
 * How a rate splits: "7.250% state + 0.500% district", or "7.250% state, no
 * district". A county with no district tax says so rather than showing a
 * 0.000% that reads like a figure -- Tuolumne really does charge the state's
 * share and nothing else.
 */
export function rateParts(state: Figure, district: Figure): string {
	return absent(district) || Decimal.from(String(district)).isZero()
		? `${pct(state)} state, no district`
		: `${pct(state)} state + ${pct(district)} district`;
}

/**
 * Hours, to the places that say what they are for:
 *
 *   billed    4  the precision an invoice line bills at
 *   allotted  2  what an agreement includes, and how much of it is used
 *   glance    1  a total read in passing
 *   whole     0  a running total in a heading or a tab
 */
const HOURS = { billed: 4, allotted: 2, glance: 1, whole: 0 } as const;
export type HoursAs = keyof typeof HOURS;

export function hours(v: Figure, as: HoursAs = 'billed'): string {
	if (absent(v)) return ABSENT;
	return `${fixed(v, HOURS[as])} h`;
}

/** Minutes as hours, worked out exactly before they are rounded to show: 25 is "0.4167 h". */
export function minutesAsHours(minutes: number, as: HoursAs = 'billed'): string {
	const places = HOURS[as];
	return hours(Ratio.of(minutes).div(60).round(places).toFixed(places), as);
}

/** Whole hours, closed up for a count beside a menu item, where a space would read as two figures: "2h". */
export function hoursBadge(minutes: number): string {
	return `${Ratio.of(minutes).div(60).round(0).toFixed(0)}h`;
}

/** Miles: driven, to the tenth ("57.0 mi"); a distance between places, to the mile ("64 mi"). */
const MILES = { driven: 1, distance: 0 } as const;

export function miles(v: Figure, as: keyof typeof MILES = 'driven'): string {
	if (absent(v)) return ABSENT;
	return `${fixed(v, MILES[as])} mi`;
}

/** A count of days or minutes, one being one: "1 day", "12 days", "5 minutes". */
export function count(n: number, unit: 'day' | 'minute'): string {
	return numbers({ style: 'unit', unit, unitDisplay: 'long' }).format(n);
}

/** Days before today: "40 days ago". */
export function daysAgo(n: number): string {
	return once('r days', () => new Intl.RelativeTimeFormat(NUMBERS, { numeric: 'always' })).format(
		-n,
		'day'
	);
}

/** A band of days: "0–7 days", or open-ended, "31+ days". */
export function dayRange(from: number, to: number | null): string {
	const f = numbers({ style: 'unit', unit: 'day', unitDisplay: 'long' });
	if (to !== null) return f.formatRange(from, to);
	return f
		.formatToParts(from)
		.map((p) => (p.type === 'integer' ? `${p.value}+` : p.value))
		.join('');
}

/**
 * A length of time as a running clock: "1:02:03", or "1:02" without its
 * seconds. Whole seconds; the hours keep counting past a day.
 */
export function elapsed(seconds: number, withSeconds = true): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if ('DurationFormat' in Intl)
		return once(
			`t ${withSeconds}`,
			() =>
				new Intl.DurationFormat(NUMBERS, {
					style: 'digital',
					hoursDisplay: 'always',
					secondsDisplay: withSeconds ? 'always' : 'auto'
				})
		).format(withSeconds ? { hours: h, minutes: m, seconds: s % 60 } : { hours: h, minutes: m });
	// A browser too old for DurationFormat still has a clock to show.
	const two = (n: number) => String(n).padStart(2, '0');
	return withSeconds ? `${h}:${two(m)}:${two(s % 60)}` : `${h}:${two(m)}`;
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

// ----------------------------------------------------------------- dates --

/**
 * DATES AND MOMENTS, two different things.
 *
 * A calendar date is the string "2026-09-17", end to end: what Postgres
 * writes, what the API carries, and what Temporal.PlainDate prints. It is
 * drawn as the UTC midnight it names, read back in UTC, so neither the
 * server's zone nor the phone's can move it a day.
 *
 * A moment -- when a timer started, when a row was written -- is stored and
 * sent in UTC, and drawn on the person's own clock: the zone on their user
 * record (#lib/zone.svelte), the same on every device they use.
 */
const onTheDay = (iso: string, options: Intl.DateTimeFormatOptions) =>
	dates(DATES, { ...options, timeZone: 'UTC' }).format(
		Temporal.PlainDate.from(iso.slice(0, 10)).toZonedDateTime('UTC').epochMilliseconds
	);

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

/** "September" -- a month in a year the screen has already named. */
export function monthName(iso: string | null | undefined): string {
	if (!iso) return ABSENT;
	return onTheDay(iso, { month: 'long' });
}

/** Two days, as a span: "1 Oct to 4 Oct 2026", the year on both ends only when they differ. */
export function span(from: string, to: string): string {
	return from.slice(0, 4) === to.slice(0, 4)
		? `${day(from)} to ${dated(to)}`
		: `${dated(from)} to ${dated(to)}`;
}

/**
 * A fiscal year by the days it runs: "FY2026" when it is one calendar year,
 * "FY2025–26" when it runs across two.
 */
export function fiscalYear(from: string, to: string): string {
	const [a, b] = [from.slice(0, 4), to.slice(0, 4)];
	return a === b ? `FY${b}` : `FY${a}–${b.slice(2)}`;
}

/**
 * The date it is, in that zone, as "2026-09-17". What a phone uses to date
 * work, so a timer stopped at 11 pm in California is dated that day wherever
 * the phone's own clock happens to be set.
 */
export function todayIn(zone: string, at: number = Date.now()): string {
	return Temporal.Instant.fromEpochMilliseconds(at)
		.toZonedDateTimeISO(zone)
		.toPlainDate()
		.toString();
}

/** "Pacific Time" -- a zone, as a person calls it, from its Postgres name. */
export function zoneName(zone: string): string {
	try {
		return (
			dates('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
				.formatToParts(Date.now())
				.find((p) => p.type === 'timeZoneName')?.value ?? zone
		);
	} catch {
		return zone;
	}
}

/** "09:21" -- a moment, on the person's clock. */
export function clock(at: number | string | Date, zone: string): string {
	return dates(DATES, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** "17 Sept 2026" -- the date of a moment, on the person's clock. */
export function datedAt(at: number | string | Date, zone: string): string {
	return dates(DATES, {
		timeZone: zone,
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(new Date(at));
}
