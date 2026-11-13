import { describe, expect, it } from 'vitest';
import { itemTotals, splitTax } from './receipt-split.ts';

describe('splitTax', () => {
	it('splits a receipt’s tax by what each item cost, adding up exactly', () => {
		// The demo's Delta Wholesale invoice: 672.00 and 85.00, 54.88 tax.
		expect(splitTax('54.88', ['672.00', '85.00'], 2)).toEqual(['48.72', '6.16']);
	});

	it('leaves what rounding loses on the last item', () => {
		const shares = splitTax('1.00', ['1', '1', '1'], 2);
		expect(shares).toEqual(['0.33', '0.33', '0.34']);
		expect(shares.reduce((n, s) => n + Number(s), 0)).toBeCloseTo(1, 10);
	});

	it('puts it all on one item, alone or where nothing cost anything', () => {
		expect(splitTax('8.12', ['112.00'], 2)).toEqual(['8.12']);
		expect(splitTax('2.00', ['0', '0'], 2)).toEqual(['0.00', '2.00']);
	});

	it('gives nothing for no items, and nothing for no tax', () => {
		expect(splitTax('5.00', [], 2)).toEqual([]);
		expect(splitTax('0', ['10', '20'], 2)).toEqual(['0.00', '0.00']);
	});
});

describe('itemTotals', () => {
	it('breaks packs down into the material’s own unit, at the price of each pack', () => {
		// 2 packs of 50 connectors at 12.97 a pack: 100 each for 25.94.
		expect(itemTotals({ count: '2', per: '50', price: '12.97', priceIs: 'each' }, 2)).toEqual({
			qty: '100',
			cost: '25.94'
		});
	});

	it('takes a price for all of them as it is', () => {
		// 1,000 ft of cable for 310.00.
		expect(itemTotals({ count: '1000', per: '', price: '310.00', priceIs: 'all' }, 2)).toEqual({
			qty: '1000',
			cost: '310.00'
		});
	});

	it('makes nothing of figures that are not one yet', () => {
		expect(itemTotals({ count: '', per: '', price: '5', priceIs: 'each' }, 2)).toBeNull();
		expect(itemTotals({ count: '0', per: '', price: '5', priceIs: 'each' }, 2)).toBeNull();
		expect(itemTotals({ count: '2', per: '-1', price: '5', priceIs: 'each' }, 2)).toBeNull();
		expect(itemTotals({ count: '2', per: '', price: 'abc', priceIs: 'each' }, 2)).toBeNull();
	});
});
