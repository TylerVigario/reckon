import { describe, expect, it } from 'vitest';
import {
	clock,
	dated,
	datedAt,
	day,
	formatMoney,
	fullDay,
	hours,
	increment,
	monthOf,
	pct,
	todayIn,
	zoneName
} from './format.ts';

/**
 * How a figure or a date is written.
 *
 * One shape for each, asserted: how a null is shown, and when a year is
 * printed, are the details copies of these would disagree about.
 */

const ABSENT = '—';

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

describe('hours', () => {
	it('bills at four places, the precision an invoice line uses', () => {
		expect(hours('1.5')).toBe('1.5000 h');
		expect(hours('0.25')).toBe('0.2500 h');
	});

	it('shows a dash for nothing', () => {
		expect(hours(undefined)).toBe(ABSENT);
	});
});

describe('the dates', () => {
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

describe('the business clock', () => {
	// 01:30 UTC on 15 March 2026, after the American clocks went forward.
	const moment = Date.UTC(2026, 2, 15, 1, 30);

	it('says what day it is where the business is, not where this runs', () => {
		expect(todayIn('America/Los_Angeles', moment)).toBe('2026-03-14');
		expect(todayIn('UTC', moment)).toBe('2026-03-15');
		expect(todayIn('Pacific/Kiritimati', moment)).toBe('2026-03-15');
		expect(todayIn('Pacific/Pago_Pago', moment)).toBe('2026-03-14');
	});

	it('writes a moment on the business clock', () => {
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
