import { describe, expect, it } from 'vitest';
import { readLot } from './stock-fields.ts';

/** 1,000 ft of cable for 310.00 and 24.80 tax, received into a material already stocked. */
const lot = (over: Record<string, string> = {}) => ({
	material_id: '0192a3b4-0000-7000-8000-000000000001',
	received_on: '2026-10-01',
	qty_received: '1000',
	ex_tax_cost: '310.00',
	tax_paid: '24.80',
	...over
});

describe('a lot received', () => {
	it('is what arrived and what all of it cost, as the receipt says', () => {
		const { values, errors } = readLot(lot(), 2);
		expect(errors).toEqual({});
		expect([values.qty_received, values.ex_tax_cost, values.tax_paid, values.paid_by]).toEqual([
			'1000',
			'310.00',
			'24.80',
			null
		]);
	});

	it('counts in its unit: no more places than the unit has', () => {
		expect(readLot(lot({ qty_received: '147.5' }), 2).errors).toEqual({});
		expect(readLot(lot({ qty_received: '147.555' }), 2).errors.qty_received).toBe(
			'At most 2 decimal places in this unit.'
		);
		expect(readLot(lot({ qty_received: '6.5' }), 0).errors.qty_received).toBe(
			'Whole numbers in this unit.'
		);
		expect(readLot(lot({ qty_received: '6.00' }), 0).errors).toEqual({});
	});

	it('has to be something', () => {
		expect(readLot(lot({ qty_received: '0' }), 2).errors.qty_received).toBe(
			'Something has to have arrived.'
		);
	});

	it('is of a material, or of one named here with what it is counted in', () => {
		const fresh = readLot(
			lot({
				material_id: '',
				name: 'Cat6 plenum cable',
				unit_id: '0192a3b4-0000-7000-8000-000000000002'
			}),
			2
		);
		expect(fresh.errors).toEqual({});
		expect(fresh.material).toEqual({
			name: 'Cat6 plenum cable',
			unit_id: '0192a3b4-0000-7000-8000-000000000002'
		});
		expect(readLot(lot({ material_id: '' }), null).errors).toMatchObject({
			name: 'What it is.',
			unit_id: 'What it is counted in.'
		});
	});
});
