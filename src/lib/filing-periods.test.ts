import { describe, expect, it } from 'vitest';
import { periodKey, periodOf, periodsTo } from './filing-periods.ts';

describe('a state’s filing periods', () => {
	it('finds the month, quarter or year a day falls in', () => {
		expect(periodOf('2026-11-27', 'monthly', null)).toEqual({
			start: '2026-11-01',
			end: '2026-11-30'
		});
		expect(periodOf('2026-02-10', 'monthly', null)).toEqual({
			start: '2026-02-01',
			end: '2026-02-28'
		});
		expect(periodOf('2026-11-27', 'quarterly', null)).toEqual({
			start: '2026-10-01',
			end: '2026-12-31'
		});
		expect(periodOf('2026-03-31', 'quarterly', 6)).toEqual({
			start: '2026-01-01',
			end: '2026-03-31'
		});
	});

	it('takes a year as the business’s, ending in its month, or December', () => {
		expect(periodOf('2026-11-27', 'annual', null)).toEqual({
			start: '2026-01-01',
			end: '2026-12-31'
		});
		expect(periodOf('2026-11-27', 'annual', 6)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
		expect(periodOf('2026-06-30', 'annual', 6)).toEqual({ start: '2025-07-01', end: '2026-06-30' });
		expect(periodOf('2026-01-15', 'annual', 1)).toEqual({ start: '2025-02-01', end: '2026-01-31' });
	});

	it('lists those ended, the latest first, and the one under way where asked', () => {
		expect(periodsTo('2026-11-27', 'quarterly', null, 3)).toEqual([
			{ start: '2026-07-01', end: '2026-09-30' },
			{ start: '2026-04-01', end: '2026-06-30' },
			{ start: '2026-01-01', end: '2026-03-31' }
		]);
		expect(periodsTo('2026-01-05', 'monthly', null, 2, true)).toEqual([
			{ start: '2026-01-01', end: '2026-01-31' },
			{ start: '2025-12-01', end: '2025-12-31' },
			{ start: '2025-11-01', end: '2025-11-30' }
		]);
	});

	it('keys a period by its first and last day', () =>
		expect(periodKey({ start: '2026-07-01', end: '2026-09-30' })).toBe('2026-07-01/2026-09-30'));
});
