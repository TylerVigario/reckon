import { Decimal, Ratio } from './decimal.ts';

/**
 * A RECEIPT'S TAX, SPLIT OVER ITS ITEMS by what each cost before tax, as a
 * receipt prints it once for everything on it. ERPNext splits a fixed tax on
 * a purchase the same way: "distribute the tax amount proportionally to each
 * item row", by each row's net amount, and "Adjust divisional loss to the last
 * item" -- so the shares add up to the receipt's tax exactly.
 *
 * Each share is rounded to the currency's places, and the last item takes
 * what rounding left. Where nothing cost anything, the last item carries it
 * all. The shares are what each lot keeps as its tax paid, which the
 * tax-paid-purchases-resold deduction reads lot by lot.
 */
export function splitTax(tax: string, costs: readonly string[], places: number): string[] {
	if (costs.length === 0) return [];
	const total = costs.reduce((n, c) => n.add(c), Decimal.ZERO);
	const shares = costs.map((c) =>
		total.isZero() ? Decimal.ZERO : Ratio.of(tax).mul(c).div(total).round(places)
	);
	const given = shares.slice(0, -1).reduce((n, s) => n.add(s), Decimal.ZERO);
	shares[shares.length - 1] = Decimal.from(tax).sub(given);
	return shares.map((s) => s.toFixed(places));
}

/**
 * One item as a receipt prints it, worked out into what is put on the shelf:
 * how many of what it says (2 packs), how many of the material's own unit
 * each holds (50, or 1 where it is sold singly), and its price -- for each of
 * what it says, or for all of them.
 *
 * Gives the quantity received in the material's unit and what all of it cost
 * before tax, to the currency's places; or null where the figures do not make
 * one yet.
 */
export function itemTotals(
	item: { count: string; per: string; price: string; priceIs: 'each' | 'all' },
	places: number
): { qty: string; cost: string } | null {
	try {
		const count = Decimal.from(item.count);
		const per = Decimal.from(item.per || '1');
		if (!count.gt(0) || !per.gt(0)) return null;
		const price = Decimal.from(item.price);
		const cost = item.priceIs === 'each' ? price.mul(count) : price;
		return { qty: count.mul(per).toString(), cost: cost.toFixed(places) };
	} catch {
		return null;
	}
}
