import { describe, expect, it } from 'vitest';
import { billingDate, lastClosed, periodOn, type Terms } from './agreement-periods.ts';

const terms = (t: Partial<Terms> = {}): Terms => ({
	startsOn: '2026-01-01',
	endsOn: null,
	interval: 'monthly',
	anchorDay: 1,
	...t
});
const charged = (periodStart: string, periodEnd: string) => ({ periodStart, periodEnd });
const span = (p: { start: string; end: string } | null) => p && [p.start, p.end];

describe('the month-end rule does not drift', () => {
	it('the 31st bills the last day of a short month and comes back', () => {
		expect(billingDate('2026-01-01', 31)).toBe('2026-01-31');
		expect(billingDate('2026-02-01', 31)).toBe('2026-02-28');
		expect(billingDate('2026-03-01', 31)).toBe('2026-03-31');
		expect(billingDate('2026-04-01', 31)).toBe('2026-04-30');
		expect(billingDate('2028-02-01', 31)).toBe('2028-02-29');
	});
	it('a day every month has is never moved', () =>
		expect(billingDate('2026-02-01', 12)).toBe('2026-02-12'));
});

describe('the period a day falls in, by the terms', () => {
	it('a month anchored on the 1st is the calendar month', () => {
		expect(span(periodOn(terms(), [], '2026-11-27'))).toEqual(['2026-11-01', '2026-11-30']);
		expect(span(periodOn(terms(), [], '2026-02-28'))).toEqual(['2026-02-01', '2026-02-28']);
	});

	it('a month anchored anywhere else runs across two', () => {
		const t = terms({ startsOn: '2026-01-15', anchorDay: 15 });
		expect(span(periodOn(t, [], '2026-11-27'))).toEqual(['2026-11-15', '2026-12-14']);
		expect(span(periodOn(t, [], '2026-11-03'))).toEqual(['2026-10-15', '2026-11-14']);
	});

	it('a 31st anchor ends on the day before the next month’s last', () => {
		const t = terms({ startsOn: '2026-01-31', anchorDay: 31 });
		expect(span(periodOn(t, [], '2026-02-10'))).toEqual(['2026-01-31', '2026-02-27']);
		expect(span(periodOn(t, [], '2026-03-01'))).toEqual(['2026-02-28', '2026-03-30']);
		expect(span(periodOn(t, [], '2026-04-15'))).toEqual(['2026-03-31', '2026-04-29']);
	});

	it('a quarter is three months from the month it starts, not the calendar’s', () => {
		const t = terms({ startsOn: '2026-02-01', interval: 'quarterly' });
		expect(span(periodOn(t, [], '2026-11-27'))).toEqual(['2026-11-01', '2027-01-31']);
		expect(span(periodOn(t, [], '2026-10-31'))).toEqual(['2026-08-01', '2026-10-31']);
	});

	it('a year is twelve months on its anchor', () => {
		const t = terms({ startsOn: '2025-03-10', interval: 'annually', anchorDay: 10 });
		expect(span(periodOn(t, [], '2026-11-27'))).toEqual(['2026-03-10', '2027-03-09']);
		expect(span(periodOn(t, [], '2026-03-09'))).toEqual(['2025-03-10', '2026-03-09']);
	});

	it('a week is seven days from the day it starts, whatever the anchor', () => {
		const t = terms({ startsOn: '2026-11-04', interval: 'weekly', anchorDay: 30 });
		expect(span(periodOn(t, [], '2026-11-04'))).toEqual(['2026-11-04', '2026-11-10']);
		expect(span(periodOn(t, [], '2026-11-27'))).toEqual(['2026-11-25', '2026-12-01']);
	});

	it('the first is cut to the day it starts, where the anchor is later', () => {
		const t = terms({ startsOn: '2026-01-10', anchorDay: 15 });
		expect(span(periodOn(t, [], '2026-01-12'))).toEqual(['2026-01-10', '2026-01-14']);
		expect(span(periodOn(t, [], '2026-01-20'))).toEqual(['2026-01-15', '2026-02-14']);
	});

	it('the last is cut to the day it ends, and nothing runs after', () => {
		const t = terms({ endsOn: '2026-11-20' });
		expect(span(periodOn(t, [], '2026-11-02'))).toEqual(['2026-11-01', '2026-11-20']);
		expect(periodOn(t, [], '2026-11-21')).toBeNull();
		expect(periodOn(t, [], '2025-12-31')).toBeNull();
	});
});

describe('a period charged is the record', () => {
	it('is the period its days fall in, whatever the terms say now', () => {
		const row = charged('2026-10-01', '2026-12-31');
		const p = periodOn(terms(), [row], '2026-11-27');
		expect(span(p)).toEqual(['2026-10-01', '2026-12-31']);
		expect(p?.charged).toBe(row);
	});

	it('and the terms’ own period around it takes only the days it does not', () => {
		const t = terms({ interval: 'quarterly' });
		const rows = [charged('2026-07-01', '2026-08-15'), charged('2026-09-20', '2026-10-19')];
		expect(span(periodOn(t, rows, '2026-09-01'))).toEqual(['2026-08-16', '2026-09-19']);
		expect(periodOn(t, rows, '2026-09-01')?.charged).toBeNull();
	});
});

describe('the period just closed', () => {
	it('is the one before today’s, while it runs', () => {
		const t = terms({ interval: 'quarterly' });
		expect(span(lastClosed(t, [], '2026-11-27'))).toEqual(['2026-07-01', '2026-09-30']);
	});

	it('is none in its first', () =>
		expect(lastClosed(terms({ startsOn: '2026-11-01' }), [], '2026-11-27')).toBeNull());

	it('is its last once it has ended, until the next would have closed too', () => {
		const t = terms({ endsOn: '2026-11-20' });
		expect(span(lastClosed(t, [], '2026-11-27'))).toEqual(['2026-11-01', '2026-11-20']);
		expect(span(lastClosed(t, [], '2026-12-31'))).toEqual(['2026-11-01', '2026-11-20']);
		expect(lastClosed(t, [], '2027-01-01')).toBeNull();
	});

	it('is a renewal’s last month while the new one runs its first', () => {
		const t = terms({ endsOn: '2026-10-31' });
		expect(span(lastClosed(t, [], '2026-11-27'))).toEqual(['2026-10-01', '2026-10-31']);
		expect(lastClosed(t, [], '2026-12-01')).toBeNull();
	});

	it('is none before it starts', () =>
		expect(lastClosed(terms({ startsOn: '2027-01-01' }), [], '2026-11-27')).toBeNull());
});
