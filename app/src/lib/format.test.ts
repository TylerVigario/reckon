import { describe, expect, it } from 'vitest';
import { dated, day, formatMoney, fullDay, hours, increment, pct } from './format';

/**
 * How a figure or a date is written.
 *
 * These existed as 24 copies of money() in seven shapes and 16 of day() in
 * eleven, disagreeing about nulls and about whether to print a year. The
 * disagreements are what these tests are for: one shape, asserted.
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

	// A zero is a figure. It was the null-handling that differed between the
	// old copies, and 0 is exactly where a loose check gets it wrong.
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
	 * NOON, NOT MIDNIGHT -- and this is the assertion that says so.
	 *
	 * A date column comes back as "2026-09-17". Handing that to Date() parses
	 * it as UTC midnight, which west of Greenwich is the evening before, so the
	 * date renders as the previous day for eight hours out of every day.
	 *
	 * Asserting the rendered string only proves it in whatever zone the test
	 * happened to run in. This asserts the mechanism instead -- the day of the
	 * month, read locally, is the day that was asked for -- which holds in
	 * every zone. CI then runs this whole suite again at UTC+14 and UTC-11,
	 * which is the part no single assertion can do.
	 */
	it('lands on the day it was given, in whatever zone this is', () => {
		for (const iso of ['2026-01-01', '2026-06-15', '2026-09-17', '2026-12-31']) {
			const [y, m, d] = iso.split('-').map(Number);
			const local = new Date(`${iso}T12:00:00`);
			expect(local.getFullYear()).toBe(y);
			expect(local.getMonth() + 1).toBe(m);
			expect(local.getDate()).toBe(d);
		}
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
