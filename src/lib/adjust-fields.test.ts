import { describe, expect, it } from 'vitest';
import { readAdjustment } from './adjust-fields.ts';

/** 5 ft of raceway used in the shop today. */
const used = (over: Record<string, string> = {}) => ({
	way: 'off',
	qty: '5',
	made_on: '2026-11-13',
	reason: 'used',
	note: 'Mounted on the bench',
	...over
});

describe('stock put right by hand', () => {
	it('is so much off or on, on a day, for a reason, and a note', () => {
		const { values, errors } = readAdjustment(used(), 2);
		expect(errors).toEqual({});
		expect([values.way, values.qty, values.reason, values.cost_each]).toEqual([
			'off',
			'5',
			'used',
			null
		]);
	});

	it('takes a reason its way allows', () => {
		expect(readAdjustment(used({ reason: 'found' }), 2).errors.reason).toBe(
			'Found stock is added, not taken off.'
		);
		expect(readAdjustment(used({ way: 'on', reason: 'damaged' }), 2).errors.reason).toBe(
			'Stock is put on when found, or to correct it.'
		);
		expect(readAdjustment(used({ way: 'on', reason: 'found' }), 2).errors).toEqual({});
		expect(readAdjustment(used({ reason: 'correction' }), 2).errors).toEqual({});
	});

	it('moves something, counted in its unit', () => {
		expect(readAdjustment(used({ qty: '0' }), 2).errors.qty).toBe('Something has to move.');
		expect(readAdjustment(used({ qty: '1.5' }), 0).errors.qty).toBe('Whole numbers in this unit.');
	});

	it('takes a cost each only for something found', () => {
		expect(
			readAdjustment(used({ way: 'on', reason: 'found', cost_each: '0.85' }), 2).errors
		).toEqual({});
		expect(readAdjustment(used({ cost_each: '0.85' }), 2).errors.cost_each).toBe(
			'What a take cost is what the shelf says it cost.'
		);
	});
});
