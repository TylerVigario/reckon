import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.ts';
import { drawFrom, unitCost, type Costing, type Shelf, type ShelfLot } from './stock-draw.ts';

const lot = (id: string, received: string, left: string, cost: string, tax = '0'): ShelfLot => ({
	id,
	qtyReceived: received,
	qtyRemaining: left,
	exTaxCost: cost,
	taxPaid: tax
});

/** Lots straight off their receipts: worth what they cost. */
const fresh = (...lots: ShelfLot[]): Shelf => ({
	lots,
	exTaxWorth: lots.reduce((n, l) => n.add(l.exTaxCost), Decimal.ZERO).toString(),
	taxWorth: lots.reduce((n, l) => n.add(l.taxPaid), Decimal.ZERO).toString()
});

/** The shelf after a draw: what it took off each lot, and what it cost off the worth. */
function after(shelf: Shelf, qty: string, costing: Costing) {
	const d = drawFrom(shelf, qty, costing);
	if ('short' in d) throw new Error(`short: ${d.short.toString()}`);
	const took = new Map(d.takes.map((t) => [t.lotId, t.qty]));
	return {
		draw: d,
		shelf: {
			lots: shelf.lots
				.map((l) => ({
					...l,
					qtyRemaining: Decimal.from(l.qtyRemaining)
						.sub(took.get(l.id) ?? Decimal.ZERO)
						.toString()
				}))
				.filter((l) => Decimal.from(l.qtyRemaining).gt(0)),
			exTaxWorth: Decimal.from(shelf.exTaxWorth).sub(d.exTaxCost).toString(),
			taxWorth: Decimal.from(shelf.taxWorth).sub(d.taxPaid).toString()
		}
	};
}

describe('a draw comes off the oldest lots first', () => {
	it('147 ft runs off the end of one spool and onto the next', () => {
		const d = drawFrom(
			fresh(lot('a', '1000', '100', '310.00'), lot('b', '1000', '1000', '350.00')),
			'147',
			'average'
		);
		if ('short' in d) throw new Error('short');
		expect(d.takes.map((t) => [t.lotId, t.qty.toString()])).toEqual([
			['a', '100'],
			['b', '47']
		]);
	});

	it('more than is on the shelf is refused, saying how much there is', () => {
		const d = drawFrom(fresh(lot('a', '100', '60', '85.00')), '61', 'average');
		expect('short' in d && d.short.toString()).toBe('60');
	});
});

describe('at the average, a draw costs its share of what the shelf is worth', () => {
	it('100 ft of $0.50 and 100 ft of $1.00 cost $0.75 a foot, and keep costing it', () => {
		// The oldest spool empties first; the cost stays the average, so the two
		// draws come to the $150.00 the spools cost.
		const one = after(
			fresh(lot('a', '100', '100', '50.00'), lot('b', '100', '100', '100.00')),
			'100',
			'average'
		);
		expect(one.draw.exTaxCost.toString()).toBe('75.0000');
		expect(one.shelf.lots.map((l) => l.id)).toEqual(['b']);
		const two = after(one.shelf, '100', 'average');
		expect(two.draw.exTaxCost.toString()).toBe('75.0000');
	});

	it('and its share of the tax paid on it', () => {
		const d = drawFrom(fresh(lot('a', '1000', '1000', '310.00', '24.80')), '147', 'average');
		if ('short' in d) throw new Error('short');
		// 147 × 0.0248 = 3.6456
		expect([d.exTaxCost.toString(), d.taxPaid.toString()]).toEqual(['45.5700', '3.6456']);
	});

	it('$33.33 for 7 comes to $33.33 one at a time', () => {
		// 4.76142857… each: what rounding one draw leaves is in the worth the
		// next is a share of, and the last takes what is left.
		let shelf = fresh(lot('a', '7', '7', '33.33'));
		const costs: string[] = [];
		for (let i = 0; i < 7; i++) {
			const next = after(shelf, '1', 'average');
			costs.push(next.draw.exTaxCost.toString());
			shelf = next.shelf;
		}
		expect(new Set(costs)).toEqual(new Set(['4.7614', '4.7615']));
		expect(costs.reduce((n, c) => n.add(c), Decimal.ZERO).toString()).toBe('33.3300');
	});
});

describe('oldest first, a draw costs what its lots cost', () => {
	it('100 ft left of a spool at $0.31 and 47 ft of the next at $0.35 is $47.45', () => {
		const shelf: Shelf = {
			lots: [lot('a', '1000', '100', '310.00'), lot('b', '1000', '1000', '350.00')],
			exTaxWorth: '381.00',
			taxWorth: '0'
		};
		const d = drawFrom(shelf, '147', 'oldest_first');
		if ('short' in d) throw new Error('short');
		expect(d.exTaxCost.toString()).toBe('47.4500');
	});
});

describe('the method can change at any time, and stock still adds up to what it cost', () => {
	it.each([
		[['average', 'oldest_first', 'average', 'oldest_first']],
		[['oldest_first', 'average', 'oldest_first', 'average']],
		[['average', 'average', 'oldest_first', 'oldest_first']]
	] as Costing[][][])('drawn %j', (methods) => {
		let shelf = fresh(
			lot('a', '100', '100', '50.00', '4.00'),
			lot('b', '100', '100', '100.00', '8.25'),
			lot('c', '50', '50', '61.17', '4.43')
		);
		let cost = Decimal.ZERO;
		let tax = Decimal.ZERO;
		for (const [i, qty] of ['70', '55', '90', '35'].entries()) {
			const next = after(shelf, qty, methods[i]);
			cost = cost.add(next.draw.exTaxCost);
			tax = tax.add(next.draw.taxPaid);
			shelf = next.shelf;
		}
		expect(shelf.lots).toEqual([]);
		expect([cost.toString(), tax.toString()]).toEqual(['211.1700', '16.6800']);
	});
});

describe('what one more costs, as the materials page shows it', () => {
	const shelf = fresh(lot('a', '100', '100', '50.00'), lot('b', '100', '100', '100.00'));

	it('at the average', () => {
		expect(unitCost(shelf, 'average')?.exTax.toString()).toBe('0.7500');
	});

	it('oldest first, the oldest lot', () => {
		expect(unitCost(shelf, 'oldest_first')?.exTax.toString()).toBe('0.5000');
	});

	it('nothing, with nothing on the shelf', () => {
		expect(unitCost(fresh(), 'average')).toBeNull();
	});
});
