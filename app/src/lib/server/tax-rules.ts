import { sql, type SQL } from 'drizzle-orm';
import { Decimal, type Ratio } from '#lib/decimal.ts';
import { invoiceLine } from './db/schema/index.ts';
import type { TAX_RULE_SETS } from './db/schema/operator.ts';

export type TaxRuleSet = (typeof TAX_RULE_SETS)[number];

/**
 * HOW A TAX IS ROUNDED is the tax's own rule, not a preference of the business:
 * where the law says how, that is how, and where it leaves the choice to the
 * business, the rule says which choices there are.
 *
 *   scope   'invoice': worked out exactly on each line and rounded once per
 *           invoice for each rate. 'line': rounded on each line, then added.
 *   method  half_up: a half or more goes up; down: what is left over is
 *           dropped; up: anything left over goes up. Each from zero, so a credit
 *           rounds as the mirror of a charge.
 *
 * Every tax total in reckon -- on an invoice, in a balance, on the home page,
 * in the valuation -- rounds through this, in SQL (taxSql) or in TypeScript
 * (roundTax), so the same lines can never come to two different taxes.
 *
 * A rule whose law lets the business choose -- Japan's method, the UK's line or
 * total -- offers that choice as a setting of that rule when it is added.
 */
export type TaxRounding = {
	scope: 'invoice' | 'line';
	method: 'half_up' | 'down' | 'up';
};

export const TAX_ROUNDING: Record<TaxRuleSet, TaxRounding> = {
	// California, Regulation 1700(a)(3): "rounded off to the nearest cent by
	// eliminating any fraction less than one-half cent and increasing any
	// fraction of one-half cent or over to the next higher cent."
	us_ca: { scope: 'invoice', method: 'half_up' },
	// A flat rate per site, for anywhere without a rule of its own: rounded as
	// California and Canada round, the common case.
	flat_per_site: { scope: 'invoice', method: 'half_up' },
	// No tax is charged, so nothing is rounded; the common case, should a line
	// carry a rate anyway.
	none: { scope: 'invoice', method: 'half_up' }
};

/** A value rounded to `places` by `method`, in SQL. */
export function roundSql(value: SQL, method: TaxRounding['method'], places: number): SQL {
	switch (method) {
		case 'half_up':
			// Postgres rounds a numeric half away from zero.
			return sql`round(${value}, ${places}::int)`;
		case 'down':
			return sql`trunc(${value}, ${places}::int)`;
		case 'up':
			// numeric throughout: 10 ^ 2 on integers is a float, and a float is
			// how 37.82 comes back as 37.82000000000001.
			return sql`round(sign(${value}) * ceil(abs(${value}) * power(10::numeric, ${places}::int))
			                 / power(10::numeric, ${places}::int), ${places}::int)`;
	}
}

/**
 * Each invoice's tax, as a subquery with the columns invoice_id and tax: its
 * lines' tax, rounded by `rounding` to `places`. Lines carry their rate, so a
 * line marked untaxable, at 0%, adds nothing.
 */
export function taxSql(rounding: TaxRounding, places: number): SQL {
	const il = invoiceLine;
	const exact = sql`${il.amount} * ${il.taxRatePct} / 100`;
	return rounding.scope === 'line'
		? sql`(select ${il.invoiceId} as invoice_id,
		              sum(${roundSql(exact, rounding.method, places)}) as tax
		         from ${il} group by 1)`
		: sql`(select invoice_id, sum(tax) as tax
		         from (select ${il.invoiceId} as invoice_id,
		                      ${roundSql(sql`sum(${exact})`, rounding.method, places)} as tax
		                 from ${il} group by ${il.invoiceId}, ${il.taxRatePct}) by_rate
		        group by invoice_id)`;
}

/**
 * One invoice's tax as a single value, over the lines `from` selects -- a FROM
 * clause and its WHERE -- each line's tax before rounding being `exact`. For a
 * figure that is not the invoice's own tax, such as what is due on the return
 * once tax-paid goods resold come off.
 */
export function lineTaxSql(exact: SQL, rounding: TaxRounding, places: number, from: SQL): SQL {
	return rounding.scope === 'line'
		? sql`(select coalesce(sum(${roundSql(exact, rounding.method, places)}), 0) ${from})`
		: sql`(select coalesce(sum(t), 0)
		         from (select ${roundSql(sql`sum(${exact})`, rounding.method, places)} as t
		                 ${from} group by ${invoiceLine.taxRatePct}) by_rate)`;
}

/**
 * The tax on a set of one invoice's lines, rounded by `rounding` to `places`:
 * each line's exact tax, with its rate. The TypeScript twin of taxSql.
 */
export function roundTax(
	lines: readonly { rate: string; tax: Ratio }[],
	rounding: TaxRounding,
	places: number
): Decimal | null {
	if (lines.length === 0) return null;
	if (rounding.scope === 'line')
		return lines
			.map((l) => l.tax.round(places, rounding.method))
			.reduce((a, b) => a.add(b).round(places));
	// By the rate itself, as the column holds it, so "7.25" and "7.2500" are one.
	const byRate = new Map<string, Ratio>();
	for (const l of lines) {
		const rate = Decimal.from(l.rate).round(4).toString();
		const had = byRate.get(rate);
		byRate.set(rate, had ? had.add(l.tax) : l.tax);
	}
	return [...byRate.values()]
		.map((t) => t.round(places, rounding.method))
		.reduce((a, b) => a.add(b).round(places));
}
