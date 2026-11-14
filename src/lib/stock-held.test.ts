import { describe, expect, it } from 'vitest';
import { withReceived, type Stocked } from './stock-held.ts';
import type { ShownReceipt } from './queue.ts';

const raceway: Stocked = {
	id: 'r',
	name: 'Raceway',
	sku: null,
	unit: 'foot',
	short: 'ft',
	places: 2,
	markup: '25',
	listed: null,
	taxable: true,
	shelf: {
		lots: [{ id: 'l1', qtyReceived: '60', qtyRemaining: '60', exTaxCost: '51', taxPaid: '3.70' }],
		exTaxWorth: '51',
		taxWorth: '3.70'
	}
};
const receipt = (items: ShownReceipt['items']): ShownReceipt => ({
	supplier: 'Delta Wholesale',
	received_on: '2026-11-13',
	total: '0',
	items
});
const item = (over: Partial<ShownReceipt['items'][number]>) => ({
	material_id: null,
	material_uuid: null,
	name: '',
	unit: 'foot',
	short: 'ft',
	places: 2,
	markup: '25',
	qty: '0',
	cost: '0',
	tax: '0',
	...over
});

describe('stock received on this phone', () => {
	it('puts what came for a material in the catalogue on its shelf, newest last', () => {
		const [r] = withReceived(
			[raceway],
			[receipt([item({ material_id: 'r', name: 'Raceway', qty: '100', cost: '90', tax: '6.53' })])]
		);
		expect(r.shelf.lots.map((l) => l.qtyRemaining)).toEqual(['60', '100']);
		expect([r.shelf.exTaxWorth, r.shelf.taxWorth]).toEqual(['141', '10.23']);
	});

	it('offers something new by the uuid made for it here, by name among the rest', () => {
		const stock = withReceived(
			[raceway],
			[
				receipt([
					item({
						material_uuid: 'u',
						name: 'Cable ties',
						unit: 'each',
						short: 'each',
						places: 0,
						qty: '100',
						cost: '12'
					})
				])
			]
		);
		expect(stock.map((m) => m.id)).toEqual(['u', 'r']);
		expect(stock[0].shelf.lots[0].qtyRemaining).toBe('100');
		expect(stock[0].taxable).toBe(true);
	});

	it('leaves the shelf as the server said with nothing waiting', () => {
		expect(withReceived([raceway], [])).toEqual([raceway]);
	});
});
