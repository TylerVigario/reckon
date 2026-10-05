import { beforeEach, describe, expect, it } from 'vitest';
import {
	clock,
	dated,
	datedAt,
	day,
	dayRange,
	count,
	daysAgo,
	elapsed,
	fiscalYear,
	fixed,
	formatMoney,
	formatPrice,
	fullDay,
	hours,
	hoursBadge,
	workedTimes,
	secondsAsHours,
	increment,
	miles,
	minutesAsHours,
	monthName,
	monthOf,
	pct,
	percent,
	quantity,
	rateParts,
	readLocaleFrom,
	span,
	todayIn,
	weekdayName,
	zoneName
} from './format.ts';

/**
 * How a figure or a date is written.
 *
 * One shape for each, asserted: how a null is shown, and when a year is
 * printed, are the details copies of these would disagree about. Each block
 * says the locale it reads in -- US English unless it says otherwise -- and the
 * last shows the same figures across locales and clocks.
 */

const ABSENT = '—';
const inLocale = (tag: string) => beforeEach(() => readLocaleFrom(() => tag));
inLocale('en-US');

describe('formatMoney', () => {
	it('takes the string Postgres actually sends', () => {
		// NUMERIC comes back as a string and stays one until this call.
		expect(formatMoney('1234.50')).toBe('$1,234.50');
	});

	it('shows a dash for nothing, never $NaN', () => {
		for (const v of [null, undefined, '']) expect(formatMoney(v)).toBe(ABSENT);
	});

	// A zero is a figure, and 0 is exactly where a loose null check gets it
	// wrong.
	it('shows a zero as a zero', () => {
		expect(formatMoney('0')).toBe('$0.00');
		expect(formatMoney(0)).toBe('$0.00');
	});

	// The currency is data -- operator.currency -- not a literal. A hardcoded
	// 'USD' here would be the same fault as a hardcoded tax rate.
	it('writes whatever currency it is given', () => {
		expect(formatMoney('1234.50', 'GBP')).toBe('£1,234.50');
		expect(formatMoney('1234.50', 'EUR')).toBe('€1,234.50');
	});

	it('shows a credit as negative rather than dropping the sign', () => {
		expect(formatMoney('-40.00')).toBe('-$40.00');
	});

	// Past fifteen digits a float has already changed the figure.
	it('writes the figure it was given, digit for digit', () => {
		expect(formatMoney('12345678901234567.89')).toBe('$12,345,678,901,234,567.89');
	});
});

describe('formatPrice', () => {
	// A price for one of something may be finer than its currency: 72.5¢ a
	// mile written as 73¢ is a different price.
	it('writes as many places as the price has, up to four', () => {
		expect(formatPrice('0.7250')).toBe('$0.725');
		expect(formatPrice('22.1875')).toBe('$22.1875');
	});

	it("and never fewer than the currency's", () => {
		expect(formatPrice('95.0000')).toBe('$95.00');
		expect(formatPrice('9500.0000', 'JPY')).toBe('¥9,500');
		expect(formatPrice('9500.5000', 'JPY')).toBe('¥9,500.5');
		expect(formatPrice('1.2000', 'KWD')).toBe('KWD\u00a01.200');
	});

	it('is a dash when there is no price', () => {
		expect(formatPrice(null)).toBe(ABSENT);
	});
});

describe('fixed', () => {
	// A float rounds 7.2505 down, because it is really 7.25049999...
	it('rounds the decimal it was given, not a float near it', () => {
		expect(fixed('7.2505', 3)).toBe('7.251');
		expect(fixed('1.005', 2)).toBe('1.01');
	});

	it('is ungrouped, and a dash for nothing', () => {
		expect(fixed('1234.5', 4)).toBe('1234.5000');
		expect(fixed(null, 2)).toBe(ABSENT);
	});
});

describe('quantity', () => {
	it('keeps up to four places and no trailing zeros, grouped', () => {
		expect(quantity('2.5000')).toBe('2.5');
		expect(quantity('1200')).toBe('1,200');
		expect(quantity('0.33333')).toBe('0.3333');
	});
});

describe('pct', () => {
	it('writes a rate to three places, which is how CDTFA publishes them', () => {
		expect(pct('7.75')).toBe('7.750%');
		expect(pct('6')).toBe('6.000%');
	});

	it('shows a dash for nothing', () => {
		expect(pct(null)).toBe(ABSENT);
	});

	it('shows a zero rate rather than treating it as absent', () => {
		expect(pct('0')).toBe('0.000%');
	});
});

describe('rateParts', () => {
	it('says both parts with their signs, or that there is no district', () => {
		expect(rateParts('7.2500', '0.5000')).toBe('7.250% state + 0.500% district');
		expect(rateParts('7.2500', '0.0000')).toBe('7.250% state, no district');
		expect(rateParts('7.2500', null)).toBe('7.250% state, no district');
	});
});

describe('hours', () => {
	it('bills at four places, the precision an invoice line uses', () => {
		expect(hours('1.5')).toBe('1.5000 hr');
		expect(hours('0.25')).toBe('0.2500 hr');
	});

	it('shows a dash for nothing', () => {
		expect(hours(undefined)).toBe(ABSENT);
	});

	it('to two places for an allotment, one for a glance', () => {
		expect(hours('10', 'allotted')).toBe('10.00 hr');
		expect(hours('3.25', 'glance')).toBe('3.3 hr');
	});

	it('from minutes, worked out exactly before it is rounded', () => {
		expect(minutesAsHours(25)).toBe('0.4167 hr');
		expect(minutesAsHours(90, 'glance')).toBe('1.5 hr');
		expect(minutesAsHours(150, 'whole')).toBe('3 hr');
	});

	it('from seconds, worked out exactly before it is rounded', () => {
		expect(secondsAsHours(1500)).toBe('0.4167 hr');
		expect(secondsAsHours(5407, 'glance')).toBe('1.5 hr');
	});

	it('closed up for a count beside a menu item', () => {
		expect(hoursBadge(9000)).toBe('3h');
	});
});

describe('miles', () => {
	it('driven to the tenth, a distance to the mile', () => {
		expect(miles('57')).toBe('57.0 mi');
		expect(miles('63.6', 'distance')).toBe('64 mi');
	});
});

describe('days', () => {
	it('counts them, one day being a day', () => {
		expect(count(1, 'day')).toBe('1 day');
		expect(count(12, 'day')).toBe('12 days');
		expect(count(1, 'minute')).toBe('1 minute');
		expect(daysAgo(230)).toBe('230 days ago');
	});

	it('bands them, closed or open-ended', () => {
		expect(dayRange(0, 7)).toBe('0–7 days');
		expect(dayRange(31, null)).toBe('31+ days');
	});
});

describe('elapsed', () => {
	it('reads as a running clock, the hours counting past a day', () => {
		expect(elapsed(3723)).toBe('1:02:03');
		expect(elapsed(303)).toBe('0:05:03');
		expect(elapsed(4800, false)).toBe('1:20');
		expect(elapsed(91200, false)).toBe('25:20');
	});
});

describe('the dates, in British English', () => {
	inLocale('en-GB');

	it('writes each length the way its screen needs it', () => {
		expect(day('2026-09-17')).toBe('17 Sept');
		expect(dated('2026-09-17')).toBe('17 Sept 2026');
		expect(fullDay('2026-09-17')).toBe('Thursday, 17 September 2026');
	});

	it('shows a dash for nothing', () => {
		for (const f of [day, dated, fullDay]) {
			expect(f(null)).toBe(ABSENT);
			expect(f(undefined)).toBe(ABSENT);
			expect(f('')).toBe(ABSENT);
		}
	});

	/**
	 * A date is drawn from its own year, month and day, read back in UTC, so the
	 * zone this runs in never moves it. Asserting the strings proves that only
	 * for the zone the test happens to run in; CI runs the whole suite again at
	 * UTC+14 and UTC-11, which is the part no single assertion can do. This one
	 * names the hard cases outright.
	 */
	it('lands on the day it was given, in whatever zone this is', () => {
		expect(fullDay('2026-01-01')).toBe('Thursday, 1 January 2026');
		expect(fullDay('2026-12-31')).toBe('Thursday, 31 December 2026');
		// The first day of summer time in both America and Europe.
		expect(day('2026-03-08')).toBe('8 Mar');
		expect(day('2026-03-29')).toBe('29 Mar');
		expect(monthOf('2026-09-01')).toBe('September 2026');
	});

	it('renders the same day it was handed, end to end', () => {
		// 1 January is the case that would roll into the previous YEAR.
		expect(dated('2026-01-01')).toBe('1 Jan 2026');
		expect(dated('2026-12-31')).toBe('31 Dec 2026');
	});

	it('names a month, alone or in its year', () => {
		expect(monthName('2026-09-01')).toBe('September');
	});

	it('spans two days, with the year on both ends only when they differ', () => {
		// A range's dash sits between thin spaces, as Intl writes one.
		expect(span('2026-10-01', '2026-10-04')).toBe('1\u2009–\u20094 Oct 2026');
		expect(span('2025-07-01', '2026-06-30')).toBe('1 Jul 2025\u2009–\u200930 Jun 2026');
	});

	it('names a day of the week', () => {
		expect(weekdayName(1)).toBe('Monday');
		expect(weekdayName(7)).toBe('Sunday');
	});

	it('names a fiscal year by the calendar years it runs in', () => {
		expect(fiscalYear('2026-01-01', '2026-12-31')).toBe('FY2026');
		expect(fiscalYear('2025-07-01', '2026-06-30')).toBe('FY2025–26');
	});
});

describe('increment', () => {
	it('names a whole unit plainly', () => {
		expect(increment(1)).toBe('to the second');
		expect(increment(60)).toBe('to the minute');
		expect(increment(3600)).toBe('to the hour');
	});

	it('counts anything coarser in the largest unit it divides into', () => {
		expect(increment(900)).toBe('to the nearest 15 minutes');
		expect(increment(30)).toBe('to the nearest 30 seconds');
		expect(increment(7200)).toBe('to the nearest 2 hours');
		expect(increment(90)).toBe('to the nearest 90 seconds');
	});

	// Null is not "unset": the column says a null bills the time as worked.
	it('says a null bills the exact time', () => {
		expect(increment(null)).toBe('the exact time');
	});
});

describe("a zone's clock, in British English", () => {
	inLocale('en-GB');

	// 01:30 UTC on 15 March 2026, after the American clocks went forward.
	const moment = Date.UTC(2026, 2, 15, 1, 30);

	it('says what day it is in that zone, not where this runs', () => {
		expect(todayIn('America/Los_Angeles', moment)).toBe('2026-03-14');
		expect(todayIn('UTC', moment)).toBe('2026-03-15');
		expect(todayIn('Pacific/Kiritimati', moment)).toBe('2026-03-15');
		expect(todayIn('Pacific/Pago_Pago', moment)).toBe('2026-03-14');
	});

	it('writes a moment on that clock', () => {
		expect(clock(moment, 'America/Los_Angeles')).toBe('18:30');
		expect(clock(moment, 'UTC')).toBe('01:30');
		expect(clock(new Date(moment).toISOString(), 'Asia/Kolkata')).toBe('07:00');
		expect(datedAt(moment, 'America/Los_Angeles')).toBe('14 Mar 2026');
		expect(datedAt(moment, 'UTC')).toBe('15 Mar 2026');
	});

	it('pads a single-digit month and day', () => {
		expect(todayIn('UTC', Date.UTC(2026, 0, 5, 12))).toBe('2026-01-05');
	});
});

describe('zoneName', () => {
	it('names a zone the way people say it, and gives back one it cannot name', () => {
		expect(zoneName('America/Los_Angeles')).toBe('Pacific Time');
		expect(zoneName('Not/AZone')).toBe('Not/AZone');
	});
});

/**
 * The same figures, read by people in different places. The locale decides
 * the language, the order of day and month and the separators; a person's
 * clock goes over it; the currency is the business's, whoever reads it.
 */
describe("in the reader's locale", () => {
	const moment = Date.UTC(2026, 2, 15, 1, 30);

	describe('US English', () => {
		inLocale('en-US');
		it('writes dates month first, and a 12-hour clock', () => {
			expect(dated('2026-09-17')).toBe('Sep 17, 2026');
			expect(fullDay('2026-09-17')).toBe('Thursday, September 17, 2026');
			expect(span('2026-10-01', '2026-10-04')).toBe('Oct 1\u2009–\u20094, 2026');
			expect(clock(moment, 'America/Los_Angeles')).toBe('6:30 PM');
		});
	});

	describe('US English, on a 24-hour clock', () => {
		inLocale('en-US-u-hc-h23');
		it('keeps the dates and changes only the clock', () => {
			expect(dated('2026-09-17')).toBe('Sep 17, 2026');
			expect(clock(moment, 'America/Los_Angeles')).toBe('18:30');
		});
	});

	describe('British English', () => {
		inLocale('en-GB');
		it('says whose dollars they are', () => {
			expect(formatMoney('1234.50')).toBe('US$1,234.50');
			expect(hours('1.5')).toBe('1.5000 hrs');
		});
	});

	describe('German', () => {
		inLocale('de-DE');
		it('writes its own separators, units and ranges', () => {
			expect(formatMoney('1234.50')).toBe('1.234,50\u00a0$');
			expect(pct('7.75')).toBe('7,750\u00a0%');
			expect(percent('16.5')).toBe('16,5\u00a0%');
			expect(hours('1.5')).toBe('1,5000 Std.');
			expect(dated('2026-09-17')).toBe('17. Sept. 2026');
			expect(span('2026-10-01', '2026-10-04')).toBe('1.–4. Okt. 2026');
			expect(weekdayName(1)).toBe('Montag');
		});
	});
});

describe('workedTimes', () => {
	const NINE_CHICAGO = '2026-10-04T14:00:00Z';
	it('is the clock where the work was done', () => {
		expect(
			workedTimes(NINE_CHICAGO, '2026-10-04T16:40:00Z', 'America/Chicago', 'America/Chicago')
		).toBe('9:00\u2009–\u200911:40\u202fAM');
	});

	it('names that zone to a reader in another', () => {
		expect(
			workedTimes(NINE_CHICAGO, '2026-10-04T16:40:00Z', 'America/Chicago', 'America/Los_Angeles')
		).toBe('9:00\u2009–\u200911:40\u202fAM, Central Time');
	});

	it('says when it ran past midnight, without a date in numbers', () => {
		expect(
			workedTimes(
				'2026-10-04T02:00:00Z',
				'2026-10-04T07:00:00Z',
				'America/Chicago',
				'America/Chicago'
			)
		).toBe('9:00 PM – 2:00 AM the next day');
	});
});
