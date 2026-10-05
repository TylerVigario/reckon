import { describe, expect, it } from 'vitest';
import { at, clockOf, endAfter, endingAt, lastAt, lengthText, parseLength } from './work-times.ts';

const LA = 'America/Los_Angeles';

/**
 * Past work as a start, a length and an end. Los Angeles changes its clocks on
 * 8 March and 1 November 2026, which is where a length that is real elapsed
 * time and one that is a difference of clock readings come apart.
 */
describe('the start and one other, and the third follows', () => {
	it('a start and a length give the end', () => {
		expect(clockOf(endAfter(at('2026-10-04', '09:00', LA), 9600))).toBe('11:40');
	});

	it('a start and an end give the length', () => {
		expect(endingAt(at('2026-10-04', '09:00', LA), '11:40')).toMatchObject({
			seconds: 9600,
			nextDay: false
		});
	});

	it('an end earlier in the day than the start is the next day', () => {
		const late = endingAt(at('2026-10-04', '22:00', LA), '02:00');
		expect([late.seconds, late.nextDay, late.ended.toPlainDate().toString()]).toEqual([
			14400,
			true,
			'2026-10-05'
		]);
	});

	it('an end that is the start is no work at all', () => {
		expect(endingAt(at('2026-10-04', '09:00', LA), '09:00').seconds).toBe(0);
	});
});

describe('a length is real elapsed time', () => {
	it('three hours from 00:30 on the night the clocks go back end at 02:30', () => {
		const start = at('2026-11-01', '00:30', LA);
		expect(clockOf(endAfter(start, 3 * 3600))).toBe('02:30');
		expect(endingAt(start, '02:30').seconds).toBe(3 * 3600);
	});

	it('01:00 to 04:00 on the night the clocks go forward is two hours', () => {
		expect(endingAt(at('2026-03-08', '01:00', LA), '04:00').seconds).toBe(2 * 3600);
	});

	it('a time the clocks skip is read an hour later', () => {
		expect(clockOf(at('2026-03-08', '02:30', LA))).toBe('03:30');
	});
});

describe('a length as it is typed, and as it is shown', () => {
	it('takes hours and minutes, hours, or minutes', () => {
		expect(['2:40', '4.5', '4.5h', '45m'].map(parseLength)).toEqual([9600, 16200, 16200, 2700]);
	});

	it('is nothing when empty, and not a number when it is none of those', () => {
		expect(parseLength('  ')).toBeNull();
		expect(parseLength('a while')).toBeNaN();
	});

	it('shows hours and minutes', () => {
		expect([lengthText(9600), lengthText(5521), lengthText(2700)]).toEqual([
			'2:40',
			'1:32',
			'0:45'
		]);
	});
});

describe('when a running timer started, told as a time of day', () => {
	// 10:00 in the morning in Los Angeles.
	const now = Temporal.Instant.from('2026-10-04T17:00:00Z');

	it('is today, at a time already past', () => {
		expect(lastAt('09:15', LA, now).toString()).toBe(
			'2026-10-04T09:15:00-07:00[America/Los_Angeles]'
		);
	});

	it('is yesterday, at a time still to come today', () => {
		expect(lastAt('23:00', LA, now).toPlainDate().toString()).toBe('2026-10-03');
	});

	it('is now, at the minute it is now', () => {
		expect(Temporal.Instant.compare(lastAt('10:00', LA, now).toInstant(), now)).toBe(0);
	});
});
