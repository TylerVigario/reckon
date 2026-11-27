import { describe, expect, it } from 'vitest';
import { parsePayment, parseReturn } from './tax-filing-fields.ts';

const quarter = { period_start: '2026-07-01', period_end: '2026-09-30' };

describe('a return as it is recorded', () => {
	it('takes the period, the day, the tax, and what was kept and paid', () => {
		const { value, errors } = parseReturn({
			...quarter,
			filed_on: '2026-10-20',
			tax: '412.50',
			kept: '1.03',
			paid: '411.47',
			reference: ' 0-123-456-789 '
		});
		expect(errors).toEqual({});
		expect(value).toEqual({
			...quarter,
			filed_on: '2026-10-20',
			tax: '412.50',
			kept: '1.03',
			paid: '411.47',
			reference: '0-123-456-789'
		});
	});

	it('keeps nothing and pays nothing where neither is said', () => {
		const { value } = parseReturn({ ...quarter, filed_on: '2026-10-20', tax: '0' });
		expect(value).toMatchObject({ kept: '0', paid: '0', reference: null });
	});

	it('refuses a period that ends before it starts, and one filed before it ends', () => {
		expect(
			parseReturn({
				period_start: '2026-09-30',
				period_end: '2026-07-01',
				filed_on: '2026-10-20',
				tax: '1'
			}).errors
		).toEqual({ period_end: 'Its last day, on or after its first.' });
		expect(parseReturn({ ...quarter, filed_on: '2026-09-29', tax: '1' }).errors.filed_on).toMatch(
			/^Filed once its period ends/
		);
	});

	it('refuses keeping more than the tax', () => {
		expect(
			parseReturn({ ...quarter, filed_on: '2026-10-20', tax: '10', kept: '10.01' }).errors
		).toEqual({ kept: 'No more than the tax on the return.' });
	});

	it('asks for the tax and the day', () => {
		expect(Object.keys(parseReturn(quarter).errors).sort()).toEqual(['filed_on', 'tax']);
	});
});

describe('a payment as it is recorded', () => {
	it('takes the tax, and apart from it penalty and interest', () => {
		const { value, errors } = parsePayment({
			...quarter,
			paid_on: '2026-11-03',
			tax: '20',
			penalty_and_interest: '2.17'
		});
		expect(errors).toEqual({});
		expect(value).toMatchObject({ tax: '20', penalty_and_interest: '2.17', reference: null });
	});

	it('can be penalty and interest alone, but not nothing', () => {
		expect(
			parsePayment({ ...quarter, paid_on: '2026-11-03', penalty_and_interest: '5' }).value
		).toMatchObject({
			tax: '0'
		});
		expect(parsePayment({ ...quarter, paid_on: '2026-11-03', tax: '0' }).errors).toEqual({
			tax: 'What was handed over.'
		});
	});

	it('can be paid before its period ends, as a prepayment is', () => {
		expect(parsePayment({ ...quarter, paid_on: '2026-08-24', tax: '300' }).errors).toEqual({});
	});
});
