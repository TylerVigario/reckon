import { Decimal, Ratio } from './decimal.ts';

/**
 * A line for what was passed on to a client: goods bought for the job, or a
 * cost paid on their behalf. One of it, at what it comes to. Goods drawn from
 * stock are below (fromStock).
 *
 *   bought    the cost before tax, marked up by the operator's markup on job
 *             purchases (none unless it is set), and sold as goods: taxed at
 *             the site's rate where the site's state taxes goods. What it cost
 *             and the tax paid on it go on the line, so the tax already paid
 *             comes off California's return where the operator claims it
 *             (Reg 1701).
 *   paid_for  the cost, as it was paid: not goods, so not marked up, and no
 *             sale -- a permit, a hire, another firm's bill, paid on the
 *             client's behalf -- so no kind of sale, and taxed nowhere.
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
	/**
	 * Each state the business collects in, and the kinds of sale it taxes
	 * there (#lib/server/sale-kinds): none, where it collects nowhere.
	 */
	taxes: Taxes;
	/** reckon's goods, which goods bought for a job are sold as. */
	goods: string;
	/** The site the line names, or null where it names none. */
	site: SiteTax | null;
	places: number;
};

/** Each state the business collects in, and the kinds of sale it taxes there. */
export type Taxes = Record<string, readonly string[]>;

/**
 * A site's tax: its state, and its area's rate where the business collects
 * there and the site has been placed in one.
 */
export type SiteTax = { state: string; ratePct: string | null };

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
		...taxedAt(bought ? terms.goods : null, terms),
		exTaxCost: Decimal.from(line.cost).toString(),
		taxPaid: Decimal.from(line.taxPaid).toString()
	};
}

/**
 * Goods drawn from stock: how much, in the material's unit, and what the draw
 * cost before tax and in tax (#lib/stock-draw). Sold at the price listed for
 * the material where there is one, and otherwise at what a unit cost marked up
 * by the material's markup, or the business's default. Sold as the kind of
 * sale the material is, and taxed at the site's rate where the site's state
 * taxes that kind.
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
	/** The kind of sale the material is. */
	kind: string;
};

export function fromStock(line: FromStock, terms: Omit<Terms, 'purchaseMarkupPct' | 'goods'>) {
	const unitPrice =
		line.listed !== null
			? Decimal.from(line.listed).round(4)
			: Ratio.of(line.cost).div(line.qty).mul(Ratio.of(line.markupPct).div(100).add(1)).round(4);
	return {
		qty: Decimal.from(line.qty).toString(),
		unit: line.unit,
		unitPrice: unitPrice.toString(),
		amount: unitPrice.mul(line.qty).round(terms.places).toString(),
		...taxedAt(line.kind, terms),
		exTaxCost: Decimal.from(line.cost).toString(),
		taxPaid: Decimal.from(line.taxPaid).toString()
	};
}

/**
 * The site's rate, where the site's state taxes the kind of sale the line is
 * (`kind`, null for what is no sale); and what is missing to know it: the
 * site, where some state the business collects in taxes the kind and the line
 * names none, or the site's area, where its state taxes the kind and the site
 * has not been placed there.
 */
function taxedAt(kind: string | null, terms: Pick<Terms, 'taxes' | 'site'>) {
	const due = kind !== null && Object.values(terms.taxes).some((kinds) => kinds.includes(kind));
	const there = due && terms.site !== null && (terms.taxes[terms.site.state] ?? []).includes(kind);
	const rate = there && terms.site!.ratePct !== null ? Decimal.from(terms.site!.ratePct) : null;
	const charged = rate !== null && !rate.isZero();
	return {
		/** The kind of sale it was sold as, which the line keeps. */
		soldAs: kind,
		taxable: charged,
		taxRatePct: charged ? rate.toString() : '0',
		taxSource: charged ? ('site' as const) : ('none' as const),
		/** Taxed somewhere the business collects, and the line names no site. */
		needsASite: due && terms.site === null,
		/** Taxed in the site's state, and the site is in no area there yet. */
		needsPlacing: there && rate === null
	};
}
