import {
	expressionBuilder,
	sql,
	type Expression,
	type NumericString,
	type SelectQueryBuilder
} from 'kysely';
import type { DB } from './db/database.ts';
import type { TaxRounding } from '../tax-rounding.ts';

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
 * in the valuation -- rounds through this, in SQL (taxes, lineTax) or in TypeScript
 * (roundTax), so the same lines can never come to two different taxes.
 *
 * A rule whose law lets the business choose -- Japan's method, the UK's line or
 * total -- offers that choice as a setting of that rule when it is added.
 */
export type { TaxRounding } from '../tax-rounding.ts';
export { roundTax } from '../tax-rounding.ts';

/**
 * Every state reckon collects in rounds the same way: worked out exactly on
 * each line, and rounded once per invoice for each rate, a half cent or more
 * going up. California's Regulation 1700(a)(3): "rounded off to the nearest
 * cent by eliminating any fraction less than one-half cent and increasing any
 * fraction of one-half cent or over to the next higher cent." The Streamlined
 * Sales and Use Tax Agreement's s. 324 has each member state round "up to the
 * next cent whenever the third decimal place is greater than four", and lets a
 * seller work it out on each item or on the invoice. A state whose law rounds
 * otherwise gets a rule of its own when a business can collect there.
 */
export const TAX_ROUNDING: TaxRounding = { scope: 'invoice', method: 'half_up' };

/** A value rounded to `places` by `method`, in SQL. */
export function roundSql(value: Expression<string>, method: TaxRounding['method'], places: number) {
	switch (method) {
		case 'half_up':
			// Postgres rounds a numeric half away from zero.
			return sql<NumericString>`round(${value}, ${places}::int)`;
		case 'down':
			return sql<NumericString>`trunc(${value}, ${places}::int)`;
		case 'up':
			// numeric throughout: 10 ^ 2 on integers is a float, and a float is
			// how 37.82 comes back as 37.82000000000001.
			return sql<NumericString>`round(sign(${value}) * ceil(abs(${value}) * power(10::numeric, ${places}::int))
			                 / power(10::numeric, ${places}::int), ${places}::int)`;
	}
}

/**
 * Each invoice's tax, as a subquery with the columns invoice_id and tax: its
 * lines' tax, rounded by `rounding` to `places`. Lines carry their rate, so a
 * line marked untaxable, at 0%, adds nothing.
 */
export function taxes(rounding: TaxRounding, places: number) {
	const eb = expressionBuilder<DB>();
	const line = expressionBuilder<DB, 'invoice_line'>();
	const exact = sql<NumericString>`${line.ref('invoice_line.amount')} * ${line.ref('invoice_line.tax_rate_pct')} / 100`;
	if (rounding.scope === 'line')
		return eb
			.selectFrom('invoice_line')
			.select([
				'invoice_line.invoice_id',
				sql<NumericString>`sum(${roundSql(exact, rounding.method, places)})`.as('tax')
			])
			.groupBy('invoice_line.invoice_id');
	return eb
		.selectFrom(
			eb
				.selectFrom('invoice_line')
				.select([
					'invoice_line.invoice_id',
					roundSql(sql`sum(${exact})`, rounding.method, places).as('tax')
				])
				.groupBy(['invoice_line.invoice_id', 'invoice_line.tax_rate_pct'])
				.as('by_rate')
		)
		.select((eb) => [
			'by_rate.invoice_id',
			sql<NumericString>`sum(${eb.ref('by_rate.tax')})`.as('tax')
		])
		.groupBy('by_rate.invoice_id');
}

/**
 * Each invoice's tax by the state that levied it, as a subquery with the
 * columns invoice_id, state and tax: its lines taxed in that state, rounded as
 * `taxes` rounds them. What each state is owed of an invoice that has lines in
 * two (#lib/server/sales-tax).
 */
export function stateTaxes(rounding: TaxRounding, places: number) {
	const eb = expressionBuilder<DB>();
	const line = expressionBuilder<DB, 'invoice_line'>();
	const exact = sql<NumericString>`${line.ref('invoice_line.amount')} * ${line.ref('invoice_line.tax_rate_pct')} / 100`;
	const taxed = eb.selectFrom('invoice_line').where('invoice_line.tax_state', 'is not', null);
	if (rounding.scope === 'line')
		return taxed
			.select([
				'invoice_line.invoice_id',
				'invoice_line.tax_state as state',
				sql<NumericString>`sum(${roundSql(exact, rounding.method, places)})`.as('tax')
			])
			.groupBy(['invoice_line.invoice_id', 'invoice_line.tax_state']);
	return eb
		.selectFrom(
			taxed
				.select([
					'invoice_line.invoice_id',
					'invoice_line.tax_state as state',
					roundSql(sql`sum(${exact})`, rounding.method, places).as('tax')
				])
				.groupBy(['invoice_line.invoice_id', 'invoice_line.tax_state', 'invoice_line.tax_rate_pct'])
				.as('by_rate')
		)
		.select((eb) => [
			'by_rate.invoice_id',
			'by_rate.state',
			sql<NumericString>`sum(${eb.ref('by_rate.tax')})`.as('tax')
		])
		.groupBy(['by_rate.invoice_id', 'by_rate.state']);
}

/**
 * One invoice's tax as a single value over `lines` -- invoice_line, filtered to
 * the lines it is over -- each line's tax before rounding being `exact`, an
 * expression over invoice_line. For a figure that is not the invoice's own
 * tax, such as what is due on the return once tax-paid goods resold come off.
 */
export function lineTax(
	lines: SelectQueryBuilder<DB, 'invoice_line', object>,
	exact: Expression<string>,
	rounding: TaxRounding,
	places: number
) {
	if (rounding.scope === 'line')
		return lines.select(
			sql<NumericString>`coalesce(sum(${roundSql(exact, rounding.method, places)}), 0)`.as('tax')
		);
	return expressionBuilder<DB>()
		.selectFrom(
			lines
				.select(roundSql(sql`sum(${exact})`, rounding.method, places).as('tax'))
				.groupBy('invoice_line.tax_rate_pct')
				.as('by_rate')
		)
		.select((eb) => sql<NumericString>`coalesce(sum(${eb.ref('by_rate.tax')}), 0)`.as('tax'));
}
