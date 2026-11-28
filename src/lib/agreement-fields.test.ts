import { describe, expect, it } from 'vitest';
import { readCoverage } from './agreement-fields.ts';

describe('an allotment', () => {
	it('of a service charged by time caps it in hours, to the hundredth', () => {
		const { values, errors } = readCoverage(
			{ allotment: 'capped', included: '2.5', overage: 'bill' },
			'hour'
		);
		expect(errors).toEqual({});
		expect(values.included).toBe('2.5');
	});

	it('of one charged each caps it by how many, a whole number', () => {
		expect(
			readCoverage({ allotment: 'capped', included: '2', overage: 'bill' }, 'each').errors
		).toEqual({});
		expect(
			readCoverage({ allotment: 'capped', included: '2.00', overage: 'bill' }, 'each').errors
		).toEqual({});
		expect(
			readCoverage({ allotment: 'capped', included: '2.5', overage: 'bill' }, 'each').errors
		).toEqual({ included: 'A whole number of times: each is covered whole or billed whole.' });
	});

	it('asks for what it includes in the words of what it counts', () => {
		expect(readCoverage({ allotment: 'capped', overage: 'bill' }, 'hour').errors).toEqual({
			included: 'How many hours it includes.'
		});
		expect(readCoverage({ allotment: 'capped', overage: 'bill' }, 'each').errors).toEqual({
			included: 'How many times it includes.'
		});
	});

	it('unlimited keeps neither, whatever was typed', () => {
		const { values, errors } = readCoverage({ allotment: 'unlimited', included: '2.5' }, 'each');
		expect(errors).toEqual({});
		expect([values.included, values.overage]).toEqual([null, null]);
	});
});
