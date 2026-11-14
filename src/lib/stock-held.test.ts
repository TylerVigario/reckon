import { describe, expect, it } from 'vitest';
import { withChanged, withReceived, type Stocked } from './stock-held.ts';
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

describe('a material changed on this phone', () => {
	const change = (kind: 'fields' | 'price', fields: Record<string, string>) => ({
		key: `${kind}|r`,
		kind,
		material_id: 'r',
		version: 1,
		base: {},
		fields,
		made_at: '2026-11-13T12:00:00Z',
		shown: { name: 'Raceway' }
	});

	it('is offered as changed: its name, and what it sells at', () => {
		const [r] = withChanged(
			[raceway],
			[
				change('fields', { name: 'Raceway, white' }),
				change('price', { by: 'price', markup_pct: '', price: '1.25' })
			],
			'20'
		);
		expect([r.name, r.listed]).toEqual(['Raceway, white', '1.25']);
	});

	it('goes back to the business’s markup, or takes one of its own', () => {
		const [own] = withChanged(
			[raceway],
			[change('price', { by: 'markup', markup_pct: '40', price: '' })],
			'20'
		);
		const [business] = withChanged(
			[raceway],
			[change('price', { by: 'business', markup_pct: '', price: '' })],
			'20'
		);
		expect([own.markup, own.listed, business.markup]).toEqual(['40', null, '20']);
	});

	it('is not offered once retired', () => {
		expect(withChanged([raceway], [change('fields', { active: 'false' })], '20')).toEqual([]);
	});
});
