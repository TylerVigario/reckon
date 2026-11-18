import { describe, expect, it } from 'vitest';
import { nextQuarter, quarterOf } from './quarters.ts';

describe('quarters', () => {
	it('finds the first day of the quarter a day falls in', () => {
		expect(quarterOf('2026-11-18')).toBe('2026-10-01');
		expect(quarterOf('2026-01-01')).toBe('2026-01-01');
		expect(quarterOf('2026-03-31')).toBe('2026-01-01');
		expect(quarterOf('2026-06-30')).toBe('2026-04-01');
	});

	it('finds the first day of the next, across a year', () => {
		expect(nextQuarter('2026-11-18')).toBe('2027-01-01');
		expect(nextQuarter('2026-02-28')).toBe('2026-04-01');
		expect(nextQuarter('2026-07-01')).toBe('2026-10-01');
	});
});
