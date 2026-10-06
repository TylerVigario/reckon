import { Decimal, Ratio } from './decimal.ts';

/** The operator's tax rules, by name (#lib/server/tax-rules). */
export type RuleSet = 'us_ca' | 'flat_per_site' | 'none';

/**
 * WHAT A TAX RULE TAXES, of what is passed on to a client: goods, bought for the
 * job or drawn from stock, and a cost paid on the client's behalf -- a permit, a
 * hire, another firm's bill -- which is not a sale of goods.
 *
 * California taxes the goods at the site's rate and not the fee (Regulation
 * 1700 taxes the sale of tangible personal property); the flat rate per site
 * taxes the goods as California does; no rule taxes nothing.
 */
export const TAXES: Record<RuleSet, { goods: boolean; paidFor: boolean }> = {
	us_ca: { goods: true, paidFor: false },
	flat_per_site: { goods: true, paidFor: false },
	none: { goods: false, paidFor: false }
};

/**
 * A line for what was passed on to a client: goods bought for the job, or a
 * cost paid on their behalf. One of it, at what it comes to.
 *
 *   bought    the cost before tax, marked up by the operator's markup on job
 *             purchases (none unless it is set), and taxed at the site's rate
 *             where the operator's tax rule taxes goods. What it cost and the
 *             tax paid on it go on the line, so the tax already paid comes off
 *             the return where the operator claims it (Reg 1701).
 *   paid_for  the cost, as it was paid: not goods, so not marked up, and taxed
 *             only where the operator's tax rule taxes such a cost.
 *
 * The price is a price for one of something, to four places; the amount is to
 * the currency's `places`. Shared, so the page can say what a line will bill as
 * it is typed, by the same rule the server saves it by.
 */
export type PassedOn = {
	kind: 'bought' | 'paid_for';
	/** What it cost before tax, all of it, as the receipt says. */
	cost: string;
	/** The tax paid on it, all of it. */
	taxPaid: string;
};

export type Terms = {
	purchaseMarkupPct: string;
	ruleSet: RuleSet;
	/** The site's rate, or null where the line has no site. */
	siteRatePct: string | null;
	places: number;
};

export function passedOn(line: PassedOn, terms: Terms) {
	const bought = line.kind === 'bought';
	const price = bought
		? Ratio.of(line.cost).mul(Ratio.of(terms.purchaseMarkupPct).div(100).add(1))
		: Ratio.of(line.cost);
	const taxed = bought ? TAXES[terms.ruleSet].goods : TAXES[terms.ruleSet].paidFor;
	const rate = taxed && terms.siteRatePct !== null ? Decimal.from(terms.siteRatePct) : null;
	return {
		qty: '1',
		unit: 'each',
		unitPrice: price.round(4).toString(),
		amount: price.round(terms.places).toString(),
		taxable: rate !== null && !rate.isZero(),
		taxRatePct: rate !== null && !rate.isZero() ? rate.toString() : '0',
		taxSource: rate !== null && !rate.isZero() ? ('site' as const) : ('none' as const),
		exTaxCost: Decimal.from(line.cost).toString(),
		taxPaid: Decimal.from(line.taxPaid).toString(),
		/** Taxed by the rule, and a site's rate is needed and missing. */
		needsASite: taxed && terms.siteRatePct === null
	};
}
