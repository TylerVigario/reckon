import { Decimal, Ratio } from '#lib/decimal.ts';
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
 * A lot: how much arrived and how much is left, and what all of it cost before
 * tax and in tax, as the receipt says them. A unit's share is the total over
 * what arrived, worked out exactly.
 */
export type Lot = { qtyReceived: string; qtyRemaining: string; exTaxCost: string; taxPaid: string };

/**
 * What a material sells for and what it cost, weighted across what is still on
 * the shelf: two spools bought at different prices are one price to sell from.
 * The price is the one listed on or before today where there is one, and
 * otherwise the weighted cost before tax plus markup. Both it and a unit's
 * costs are prices for one of something, so to four places, finer than the
 * currency where they need to be: $0.31 a foot at 20% sells at $0.372. Null
 * with nothing left.
 */
export function materialWorth(lots: readonly Lot[], markupPct: string, listed: string | null) {
	const open = lots.filter((l) => Decimal.from(l.qtyRemaining).gt(0));
	const onHand = open.reduce((n, l) => n.add(l.qtyRemaining), Decimal.ZERO);
	// Each lot's remaining share of what it cost: its total, times what is left
	// of it over what arrived.
	const weighted = (total: (l: Lot) => string) =>
		onHand.isZero()
			? null
			: open
					.reduce(
						(n, l) => n.add(Ratio.of(total(l)).mul(l.qtyRemaining).div(l.qtyReceived)),
						Ratio.of(0)
					)
					.div(onHand);
	const exTax = weighted((l) => l.exTaxCost);
	const taxPaid = weighted((l) => l.taxPaid);
	return {
		onHand,
		exTax: exTax?.round(4) ?? null,
		taxPaid: taxPaid?.round(4) ?? null,
		price:
			listed !== null
				? Decimal.from(listed)
				: (exTax?.mul(Ratio.of(markupPct).div(100).add(1)).round(4) ?? null)
	};
}
