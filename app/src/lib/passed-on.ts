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
 * cost paid on their behalf. One of it, at what it comes to. Goods drawn from
 * stock are below (fromStock).
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
	return {
		qty: '1',
		unit: 'each',
		unitPrice: price.round(4).toString(),
		amount: price.round(terms.places).toString(),
		...taxedAt(bought ? TAXES[terms.ruleSet].goods : TAXES[terms.ruleSet].paidFor, terms),
		exTaxCost: Decimal.from(line.cost).toString(),
		taxPaid: Decimal.from(line.taxPaid).toString()
	};
}

/**
 * Goods drawn from stock: how much, in the material's unit, and what the draw
 * cost before tax and in tax (#lib/stock-draw). Sold at the price listed for
 * the material where there is one, and otherwise at what a unit cost marked up
 * by the material's markup, or the business's default. Taxed as goods, at the
 * site's rate, unless the material is one the business does not tax.
 */
export type FromStock = {
	qty: string;
	/** The material's unit, as the line will say it: "foot". */
	unit: string;
	cost: string;
	taxPaid: string;
	/** The price listed for one, today, or null to mark the cost up. */
	listed: string | null;
	markupPct: string;
	/** Whether the material is goods the business taxes. */
	taxable: boolean;
};

export function fromStock(line: FromStock, terms: Omit<Terms, 'purchaseMarkupPct'>) {
	const unitPrice =
		line.listed !== null
			? Decimal.from(line.listed).round(4)
			: Ratio.of(line.cost).div(line.qty).mul(Ratio.of(line.markupPct).div(100).add(1)).round(4);
	return {
		qty: Decimal.from(line.qty).toString(),
		unit: line.unit,
		unitPrice: unitPrice.toString(),
		amount: unitPrice.mul(line.qty).round(terms.places).toString(),
		...taxedAt(line.taxable && TAXES[terms.ruleSet].goods, terms),
		exTaxCost: Decimal.from(line.cost).toString(),
		taxPaid: Decimal.from(line.taxPaid).toString()
	};
}

/** The site's rate where the rule taxes the line, and whether one is missing. */
function taxedAt(taxed: boolean, terms: { siteRatePct: string | null }) {
	const rate = taxed && terms.siteRatePct !== null ? Decimal.from(terms.siteRatePct) : null;
	const charged = rate !== null && !rate.isZero();
	return {
		taxable: charged,
		taxRatePct: charged ? rate.toString() : '0',
		taxSource: charged ? ('site' as const) : ('none' as const),
		/** Taxed by the rule, and a site's rate is needed and missing. */
		needsASite: taxed && terms.siteRatePct === null
	};
}
