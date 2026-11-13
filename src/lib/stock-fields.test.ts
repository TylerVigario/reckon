import { describe, expect, it } from 'vitest';
import { MOST_ITEMS, readReceipt } from './stock-fields.ts';

const CABLE = '0192a3b4-0000-7000-8000-000000000001';
const FOOT = '0192a3b4-0000-7000-8000-000000000002';

/** A Delta Wholesale invoice, 24.80 tax. */
const receipt = (over: Record<string, string> = {}) => ({
	received_on: '2026-10-01',
	supplier: 'Delta Wholesale',
	tax_paid: '24.80',
	...over
});
/** 1,000 ft of cable for 310.00, into a material already stocked. */
const cable = (over: Record<string, string> = {}) => ({
	material_id: CABLE,
	count: '1000',
	per: '',
	price: '310.00',
	price_is: 'all',
	...over
});
const read = (
	items: Record<string, string>[],
	head: Record<string, string> = receipt(),
	places: number | null = 2
) => readReceipt(head, items, () => places, 2);

describe('a receipt received', () => {
	it('is what was printed once, and each item as the shelf takes it', () => {
		const r = read([cable()]);
		expect(r.errors).toEqual({});
		expect([r.values.received_on, r.values.supplier, r.values.tax_paid, r.values.paid_by]).toEqual([
			'2026-10-01',
			'Delta Wholesale',
			'24.80',
			null
		]);
		expect(r.items).toEqual([{ material_id: CABLE, material: null, qty: '1000', cost: '310.00' }]);
	});

	it('breaks packs down into the material’s own unit, priced for each pack', () => {
		const r = read(
			[cable({ count: '2', per: '50', price: '12.97', price_is: 'each' })],
			receipt(),
			0
		);
		expect(r.errors).toEqual({});
		expect(r.items[0]).toMatchObject({ qty: '100', cost: '25.94' });
	});

	it('counts in its unit: no more places than the unit has', () => {
		expect(read([cable({ count: '147.5' })]).errors).toEqual({});
		expect(read([cable({ count: '147.555' })]).errors['items.0.count']).toBe(
			'At most 2 decimal places in this unit.'
		);
		expect(read([cable({ count: '6.5' })], receipt(), 0).errors['items.0.count']).toBe(
			'Whole numbers in this unit.'
		);
	});

	it('has to bring something in', () => {
		expect(read([cable({ count: '0' })]).errors['items.0.count']).toBe(
			'Something has to have arrived.'
		);
		expect(read([cable({ per: '0' })]).errors['items.0.per']).toBe('A pack holds something.');
		expect(read([]).errors.items).toBe('At least one item.');
		expect(read(Array.from({ length: MOST_ITEMS + 1 }, () => cable())).errors.items).toBe(
			`At most ${MOST_ITEMS} items on one receipt.`
		);
	});

	it('takes something new to the catalogue, named with what it is counted in', () => {
		const fresh = read([cable({ material_id: '', name: 'Cat6 plenum cable', unit_id: FOOT })]);
		expect(fresh.errors).toEqual({});
		expect(fresh.items[0].material).toEqual({ name: 'Cat6 plenum cable', unit_id: FOOT });
		expect(read([cable({ material_id: '' })], receipt(), null).errors).toMatchObject({
			'items.0.name': 'What it is.',
			'items.0.unit_id': 'What it is counted in.'
		});
	});

	it('says which item is wrong, and what of the receipt', () => {
		const r = read([cable(), cable({ price: '' })], receipt({ received_on: '' }));
		expect(r.errors).toMatchObject({
			received_on: 'Which day it arrived.',
			'items.1.price': 'What it cost before tax.'
		});
	});
});
