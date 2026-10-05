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

/** Minutes as hours to the hundredth: 75 is "1.25". */
export const hoursOf = (minutes: number) => Ratio.of(minutes).div(60).round(2).toFixed(2);

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

/** A lot still on the shelf: how much is left, and what each unit cost before and in tax. */
export type Lot = { qtyRemaining: string; exTaxCostPerUnit: string; taxPaidPerUnit: string };

/**
 * What a material sells for and what it cost, weighted across what is still on
 * the shelf: two spools bought at different prices are one price to sell from.
 * The price is the one listed on or before today where there is one, and
 * otherwise the weighted cost before tax plus markup, to the currency's
 * `places`. Costs are to four places, as a lot holds them; null with nothing
 * left.
 */
export function materialWorth(
	lots: readonly Lot[],
	markupPct: string,
	listed: string | null,
	places: number
) {
	const open = lots.filter((l) => Decimal.from(l.qtyRemaining).gt(0));
	const onHand = open.reduce((n, l) => n.add(l.qtyRemaining), Decimal.ZERO);
	const weighted = (perUnit: (l: Lot) => string) =>
		onHand.isZero()
			? null
			: open
					.reduce((n, l) => n.add(Ratio.of(l.qtyRemaining).mul(perUnit(l))), Ratio.of(0))
					.div(onHand);
	const exTax = weighted((l) => l.exTaxCostPerUnit);
	const taxPaid = weighted((l) => l.taxPaidPerUnit);
	return {
		onHand,
		exTax: exTax?.round(4) ?? null,
		taxPaid: taxPaid?.round(4) ?? null,
		price:
			listed !== null
				? Decimal.from(listed)
				: (exTax?.mul(Ratio.of(markupPct).div(100).add(1)).round(places) ?? null)
	};
}
