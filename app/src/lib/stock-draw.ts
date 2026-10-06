import { Decimal, Ratio } from './decimal.ts';

/**
 * HOW STOCK IS COSTED, as the operator chooses it: at the average of what is on
 * the shelf, or the oldest first. Average unless the business says otherwise.
 *
 * Either way a draw takes its quantity off the oldest lots first, as goods
 * leave a shelf, so what is left of each lot is what is left of that receipt.
 * The method decides only what the draw cost.
 */
export const COSTINGS = ['average', 'oldest_first'] as const;
export type Costing = (typeof COSTINGS)[number];

/**
 * A lot on the shelf: how much arrived and how much is left, and what all of it
 * cost before tax and in tax, as its receipt says them.
 */
export type ShelfLot = {
	id: string;
	qtyReceived: string;
	qtyRemaining: string;
	exTaxCost: string;
	taxPaid: string;
};

/**
 * What a material has on the shelf: its lots with something left, oldest first,
 * and what all of it is worth -- every lot's cost less the cost of every line
 * drawn from them, before tax and in tax. The worth is the books' figure, so
 * what is drawn adds up to what was paid however it was costed, and whatever
 * the method was when each draw was made.
 */
export type Shelf = {
	lots: readonly ShelfLot[];
	exTaxWorth: string;
	taxWorth: string;
};

export type Draw = {
	/** How much comes off each lot, oldest first. */
	takes: { lotId: string; qty: Decimal }[];
	/** What all of it cost, before tax and in tax, to four places. */
	exTaxCost: Decimal;
	taxPaid: Decimal;
};

const onHandOf = (shelf: Shelf) => shelf.lots.reduce((n, l) => n.add(l.qtyRemaining), Decimal.ZERO);

/** What the receipts say the lots' remains cost: each lot's share of its total. */
const receiptCost = (
	parts: readonly { lot: ShelfLot; qty: Decimal | string }[],
	total: (l: ShelfLot) => string
) =>
	parts.reduce(
		(n, p) => n.add(Ratio.of(total(p.lot)).mul(p.qty).div(p.lot.qtyReceived)),
		Ratio.of(0)
	);

/**
 * What `qty` drawn from the shelf takes, and what it cost; or how much there is,
 * when that is less than asked for.
 *
 *   average       its share of what the shelf is worth: qty × worth / on hand.
 *   oldest_first  what the receipts of the lots it comes off say, scaled by
 *                 what the shelf is worth over what its receipts say. The scale
 *                 is one while stock has only ever been costed oldest first; it
 *                 carries what average draws left when the method changed.
 *
 * The draw that empties the shelf takes all of its worth, so nothing is left
 * over from rounding each draw to four places.
 */
export function drawFrom(shelf: Shelf, qty: string, costing: Costing): Draw | { short: Decimal } {
	const want = Decimal.from(qty);
	const onHand = onHandOf(shelf);
	if (want.gt(onHand)) return { short: onHand };

	const takes: Draw['takes'] = [];
	const from: { lot: ShelfLot; qty: Decimal }[] = [];
	let left = want;
	for (const lot of shelf.lots) {
		if (left.isZero()) break;
		const take = Decimal.min(left, Decimal.from(lot.qtyRemaining));
		if (take.isZero()) continue;
		takes.push({ lotId: lot.id, qty: take });
		from.push({ lot, qty: take });
		left = left.sub(take);
	}

	if (want.eq(onHand))
		return {
			takes,
			exTaxCost: Decimal.from(shelf.exTaxWorth).round(4),
			taxPaid: Decimal.from(shelf.taxWorth).round(4)
		};

	const costOf = (worth: string, total: (l: ShelfLot) => string): Decimal => {
		if (costing === 'average') return Ratio.of(worth).mul(want).div(onHand).round(4);
		const all = receiptCost(
			shelf.lots.map((lot) => ({ lot, qty: lot.qtyRemaining })),
			total
		);
		// Lots that cost nothing on their receipts leave nothing to scale by; the
		// worth is then shared out as the average shares it.
		if (all.num === 0n) return Ratio.of(worth).mul(want).div(onHand).round(4);
		return receiptCost(from, total).mul(worth).div(all).round(4);
	};
	return {
		takes,
		exTaxCost: costOf(shelf.exTaxWorth, (l) => l.exTaxCost),
		taxPaid: costOf(shelf.taxWorth, (l) => l.taxPaid)
	};
}

/**
 * What one more unit off the shelf costs, before tax and in tax, to four
 * places: the average, or the oldest lot's, scaled as a draw is. Null with
 * nothing on the shelf.
 */
export function unitCost(
	shelf: Shelf,
	costing: Costing
): { exTax: Decimal; taxPaid: Decimal } | null {
	const onHand = onHandOf(shelf);
	if (onHand.isZero()) return null;
	const per = (worth: string, total: (l: ShelfLot) => string): Decimal => {
		if (costing === 'average') return Ratio.of(worth).div(onHand).round(4);
		const all = receiptCost(
			shelf.lots.map((lot) => ({ lot, qty: lot.qtyRemaining })),
			total
		);
		if (all.num === 0n) return Ratio.of(worth).div(onHand).round(4);
		const first = shelf.lots.find((l) => Decimal.from(l.qtyRemaining).gt(0))!;
		return Ratio.of(total(first)).div(first.qtyReceived).mul(worth).div(all).round(4);
	};
	return {
		exTax: per(shelf.exTaxWorth, (l) => l.exTaxCost),
		taxPaid: per(shelf.taxWorth, (l) => l.taxPaid)
	};
}
