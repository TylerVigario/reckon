/**
 * STOCK RECEIVED ON THIS PHONE, usable at once: what Add a line draws from is
 * the shelf as the server last said it, with each receipt still waiting here
 * put on it -- a lot on a material in the catalogue, or something new, named
 * by the uuid made for it here, which a line drawing from it names until the
 * receipt arrives (#lib/queue). A line drawn from it is costed again when it
 * arrives, off the shelf as it is then, as every line from stock is.
 */
import { Decimal } from './decimal.ts';
import type { Shelf } from './stock-draw.ts';
import type { ShownReceipt } from './queue.ts';

/** A material as Add a line offers it: what it is, how it sells, and its shelf. */
export type Stocked = {
	id: string;
	name: string;
	sku: string | null;
	unit: string;
	short: string;
	places: number;
	markup: string;
	listed: string | null;
	taxable: boolean;
	shelf: Shelf;
};

/** The shelf with one more lot on it, newest last, and its worth with it. */
const plus = (
	shelf: Shelf,
	lot: { id: string; qty: string; cost: string; tax: string }
): Shelf => ({
	lots: [
		...shelf.lots,
		{
			id: lot.id,
			qtyReceived: lot.qty,
			qtyRemaining: lot.qty,
			exTaxCost: lot.cost,
			taxPaid: lot.tax
		}
	],
	exTaxWorth: Decimal.from(shelf.exTaxWorth).add(lot.cost).toString(),
	taxWorth: Decimal.from(shelf.taxWorth).add(lot.tax).toString()
});

/**
 * What Add a line offers, with every receipt waiting on this phone on the
 * shelf: in the order received, and something new after what the catalogue
 * has, by name.
 */
export function withReceived(
	stock: readonly Stocked[],
	receipts: readonly ShownReceipt[]
): Stocked[] {
	const out = new Map(stock.map((m) => [m.id, m]));
	receipts.forEach((r, i) =>
		r.items.forEach((item, n) => {
			const id = item.material_id ?? item.material_uuid;
			if (!id) return;
			const lot = { id: `held-${i}-${n}`, qty: item.qty, cost: item.cost, tax: item.tax };
			const had = out.get(id);
			out.set(
				id,
				had
					? { ...had, shelf: plus(had.shelf, lot) }
					: {
							id,
							name: item.name,
							sku: null,
							unit: item.unit,
							short: item.short,
							places: item.places,
							markup: item.markup,
							listed: null,
							taxable: true,
							shelf: plus({ lots: [], exTaxWorth: '0', taxWorth: '0' }, lot)
						}
			);
		})
	);
	return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
