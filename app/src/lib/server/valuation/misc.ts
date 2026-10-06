import { Decimal, Ratio } from '#lib/decimal.ts';
import { unitCost, type Costing, type Shelf } from '#lib/stock-draw.ts';
import { billedAmount, jobRate, priceOn, type Price, type ServiceTerms } from './pricing.ts';

/**
 * The day in `month` that an agreement anchored on `anchorDay` bills: the
 * anchor, or the month's last day when the month is shorter. Computed fresh
 * each month, so a 31st anchor bills 28 February and 31 March, never drifting
 * onto the 28th.
 */
export function billingDate(month: string, anchorDay: number): string {
	// `with` keeps the day inside the month: the 31st of February is its last.
	return Temporal.PlainDate.from(month).with({ day: anchorDay }).toString();
}

/** Seconds as hours to the hundredth: 4500 is "1.25". */
export const hoursOf = (seconds: number) => Ratio.of(seconds).div(3600).round(2).toFixed(2);

/**
 * What one trip leg bills: one person's rate for its service on the day, times
 * its miles, to the currency's `places` (#lib/currency).
 */
export function legWorth(
	leg: { serviceId: string | null; entityId: string | null; miles: string },
	travelledOn: string,
	services: ReadonlyMap<string, ServiceTerms>,
	prices: readonly Price[],
	places: number
): { rate: Decimal | null; billed: Decimal | null } {
	const service = leg.serviceId ? services.get(leg.serviceId) : undefined;
	if (!service || !leg.serviceId) return { rate: null, billed: null };
	const rate = jobRate(priceOn(prices, leg.serviceId, leg.entityId, travelledOn), 1);
	return { rate, billed: billedAmount(service, rate, Ratio.of(leg.miles), places) };
}

/**
 * What a material sells for and what one more of it costs, as the business
 * costs its stock (#lib/stock-draw): the average of what is on the shelf, so
 * two spools bought at different prices are one price to sell from; or the
 * oldest lot's. The price is the one listed on or before today where there is
 * one, and otherwise that cost before tax plus markup. Both are prices for one
 * of something, so to four places, finer than the currency where they need to
 * be: $0.31 a foot at 20% sells at $0.372. Null with nothing left.
 */
export function materialWorth(
	shelf: Shelf,
	costing: Costing,
	markupPct: string,
	listed: string | null
) {
	const onHand = shelf.lots.reduce((n, l) => n.add(l.qtyRemaining), Decimal.ZERO);
	const cost = unitCost(shelf, costing);
	return {
		onHand,
		exTax: cost?.exTax ?? null,
		taxPaid: cost?.taxPaid ?? null,
		price:
			listed !== null
				? Decimal.from(listed)
				: cost
					? Ratio.of(cost.exTax).mul(Ratio.of(markupPct).div(100).add(1)).round(4)
					: null
	};
}
