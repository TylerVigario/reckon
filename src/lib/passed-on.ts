import { Decimal, Ratio } from './decimal.ts';
import { stateName } from './us-states.ts';

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
	/** Its tax set by hand, where goods bought for the job are the exception. */
	byHand?: ByHand | null;
};

export type Terms = {
	purchaseMarkupPct: string;
	/**
	 * Each state the business collects in, and the kinds of sale it taxes
	 * there (#lib/server/sale-kinds): none, where it collects nowhere.
	 */
	taxes: Taxes;
	/**
	 * Each state the business collects in, and the kinds of sale some area of
	 * it taxes by a piece for that kind alone, whether or not the state does.
	 */
	areaTaxes: Taxes;
	/** reckon's goods, which goods bought for a job are sold as. */
	goods: string;
	/** The site the line names, or null where it names none. */
	site: SiteTax | null;
	places: number;
};

/** Each state the business collects in, and the kinds of sale it taxes there. */
export type Taxes = Record<string, readonly string[]>;

/**
 * A site's tax: its state, and where the business collects there and the site
 * has been placed in an area, the area's rate on every kind the state taxes
 * and what its pieces for one kind alone add, by kind; and its client's
 * exemptions in force in its state, oldest first.
 */
export type SiteTax = {
	state: string;
	ratePct: string | null;
	kindRates: Readonly<Record<string, string>>;
	exempt: readonly InForce[];
};

/**
 * A client's exemption in force in a state (#lib/server/exemptions): which,
 * and the kinds of sale it covers, or null for every kind.
 */
export type InForce = { id: string; kinds: readonly string[] | null };

/**
 * The rate a line of `kind` taxed at the site's rate is taxed at: the area's
 * rate on every kind, and what its pieces for that kind add. Null where the
 * site is in no area to know it.
 */
export function siteRateFor(site: SiteTax, kind: string | null): Decimal | null {
	if (site.ratePct === null) return null;
	const own = kind !== null ? site.kindRates[kind] : undefined;
	return own === undefined ? Decimal.from(site.ratePct) : Decimal.from(site.ratePct).add(own);
}

/**
 * A line's tax set by hand, by someone with Full, where the line is the
 * exception to its kind (#lib/line-fields readByHand): not taxed, or taxed at
 * the site's rate (ratePct null) or at another. Taxed, it is owed where the
 * line went: a site in a state the business collects in, placed in an area.
 */
export type ByHand = { taxed: false } | { taxed: true; ratePct: string | null };

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
		...taxedAt(bought ? terms.goods : null, terms, bought ? (line.byHand ?? null) : null),
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
	/** Its tax set by hand, where this line is the exception to its kind. */
	byHand?: ByHand | null;
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
		...taxedAt(line.kind, terms, line.byHand ?? null),
		exTaxCost: Decimal.from(line.cost).toString(),
		taxPaid: Decimal.from(line.taxPaid).toString()
	};
}

/**
 * How the kind of sale a line is (`kind`, null for what is no sale) is taxed
 * at its site: at the site's rate where the site's state taxes the kind, and
 * otherwise at what its area's pieces for that kind alone come to, where it
 * has any. And what is missing to know it: the site, where some state the
 * business collects in taxes the kind or has an area that does and the line
 * names none, or the site's area, where its state or an area of it taxes the
 * kind and the site has not been placed there.
 *
 * Its client exempt there from its kind, it is not taxed, and names the
 * exemption: the oldest in force at the site's state that covers the kind,
 * where the line would be taxed as its kind or the site's area is needed to
 * know. An exempt sale's tax is nothing wherever in the state it is, so the
 * site need not be placed for it.
 *
 * Or, where the line's tax was set by hand (`byHand`), that: not taxed, or
 * taxed at the site's rate or at another, where the line went -- for a client
 * exempt there, the exception the reason explains. A tax set by hand that
 * would change nothing is refused, so no line keeps a reason for being taxed
 * as its kind is anyway.
 */
function taxedAt(
	kind: string | null,
	terms: Pick<Terms, 'taxes' | 'areaTaxes' | 'site'>,
	byHand: ByHand | null
) {
	const site = terms.site;
	// Whether a state taxes the kind, and whether some area of it does alone.
	const stateTaxes = (state: string) => kind !== null && (terms.taxes[state] ?? []).includes(kind);
	const areaTaxes = (state: string) =>
		kind !== null && (terms.areaTaxes[state] ?? []).includes(kind);
	const due = Object.keys(terms.taxes).some((s) => stateTaxes(s) || areaTaxes(s));
	const everyKind = site !== null && stateTaxes(site.state);
	const there = site !== null && (everyKind || areaTaxes(site.state));
	const rate =
		there && site.ratePct !== null
			? everyKind
				? siteRateFor(site, kind)
				: Decimal.from((kind !== null && site.kindRates[kind]) || '0')
			: null;
	const charged = rate !== null && !rate.isZero();
	const exemption =
		site !== null && kind !== null && (charged || (there && rate === null))
			? (site.exempt.find((x) => x.kinds === null || x.kinds.includes(kind)) ?? null)
			: null;
	const taxed = charged && exemption === null;
	const asItsKind = {
		/** The kind of sale it was sold as, which the line keeps. */
		soldAs: kind,
		taxable: taxed,
		taxRatePct: taxed ? rate.toString() : '0',
		taxSource: exemption ? ('exempt' as const) : taxed ? ('site' as const) : ('none' as const),
		/** The client's exemption it is untaxed by, where it is. */
		taxExemption: exemption?.id ?? null,
		/** Whether its tax was set by hand, rather than its kind's. */
		byHand: false,
		/** Taxed somewhere the business collects, and the line names no site. */
		needsASite: due && site === null,
		/** Taxed in the site's state or an area of it, and the site is in no area there yet. */
		needsPlacing: there && rate === null && exemption === null,
		/** Why its tax cannot be set by hand as it was, by the box that says so. */
		refused: null as Record<string, string> | null
	};
	if (byHand === null) return asItsKind;
	const refuse = (field: string, why: string) => ({
		...asItsKind,
		needsASite: false,
		needsPlacing: false,
		refused: { [field]: why }
	});

	if (!byHand.taxed) {
		if (exemption)
			return refuse('taxable', 'It is not taxed there anyway: the client is exempt there.');
		if (!charged && !asItsKind.needsASite && !asItsKind.needsPlacing)
			return refuse('taxable', 'It is not taxed there anyway, as its kind is.');
		return {
			...asItsKind,
			taxable: false,
			taxRatePct: '0',
			taxSource: 'none' as const,
			taxExemption: null,
			byHand: true,
			needsASite: false,
			needsPlacing: false
		};
	}

	// Taxed, it is owed where it went: a site, in a state the business collects
	// in, in an area there.
	const taxedThere = {
		...asItsKind,
		taxExemption: null,
		byHand: true,
		needsASite: false,
		needsPlacing: false
	};
	if (site === null) return { ...taxedThere, needsASite: true };
	if (!(site.state in terms.taxes))
		return refuse(
			'taxable',
			`The business doesn't collect in ${stateName(site.state)}, so it charges no tax there.`
		);
	const siteRate = siteRateFor(site, kind);
	if (siteRate === null) return { ...taxedThere, needsPlacing: true };
	if (byHand.ratePct === null) {
		if (taxed && everyKind)
			return refuse('taxable', 'It is taxed at the site’s rate anyway, as its kind is.');
		if (siteRate.isZero()) return refuse('taxable', 'The site’s rate is nothing.');
		return {
			...taxedThere,
			taxable: true,
			taxRatePct: siteRate.toString(),
			taxSource: 'site' as const
		};
	}
	const typed = Decimal.from(byHand.ratePct);
	if (typed.eq(siteRate))
		return refuse('tax_rate_pct', 'That is the site’s rate: choose taxed at the site’s rate.');
	if (taxed && typed.eq(rate))
		return refuse('tax_rate_pct', 'It is taxed at that rate there anyway, as its kind is.');
	return {
		...taxedThere,
		taxable: true,
		taxRatePct: typed.toString(),
		taxSource: 'override' as const
	};
}

/**
 * How a line of `kind` is taxed at the site, as its kind is: what a page says
 * beside the choice of setting it by hand.
 */
export function asItsKind(kind: string | null, terms: Pick<Terms, 'taxes' | 'areaTaxes' | 'site'>) {
	return taxedAt(kind, terms, null);
}

/**
 * What a line's tax still needs, or why it is refused, by the box each is
 * about: the page says it as a person types, and the server again.
 */
export function taxNeeds(line: {
	needsASite: boolean;
	needsPlacing: boolean;
	refused: Record<string, string> | null;
}): Record<string, string> | null {
	if (line.refused) return line.refused;
	if (line.needsASite) return { site_id: 'Where it went, so its tax rate is known.' };
	if (line.needsPlacing)
		return { site_id: 'That site is in no tax area yet, so its rate is not known.' };
	return null;
}
