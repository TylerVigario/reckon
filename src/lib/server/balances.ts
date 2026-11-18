import { expressionBuilder, sql, type Expression, type NumericString } from 'kysely';
import type { DB } from './db/database.ts';
import { taxes, type TaxRounding } from './tax-rules.ts';

/**
 * Every invoice, what it comes to, and what is still to pay on it -- a subquery
 * to join or select from (`.leftJoin(balances(rounding, places).as('b'), ...)`,
 * or `.with('owing', () => balances(...))`), with the columns invoice_id,
 * entity_id, status, net, tax, gross, paid, credited and owed.
 *
 * net is the lines; tax is what they carry, rounded as sales tax is
 * (#lib/server/tax-rules), to the currency's `places` (#lib/currency);
 * gross is the two together: what the invoice asks for. owed is gross less what
 * payments have been put against it and what credit notes have taken off it,
 * and never below nothing, so a part-paid invoice is still owed its remainder
 * and an overpaid one is not owed a negative. An invoice is paid when nothing
 * is owed: that is a figure, not a status (0028).
 *
 * Stated once, so the home page, the client list, a client's page, the invoice
 * list and an invoice itself cannot disagree about what somebody owes.
 */
export function balances(rounding: TaxRounding, places: number) {
	const eb = expressionBuilder<DB>();
	// Each figure is a sum of amounts already at the currency's places, so this
	// rounds nothing: it writes every one to those places, "0" as "0.00".
	const at = (v: Expression<unknown>) => sql<NumericString>`round(${v}, ${places}::int)`;
	return eb
		.selectFrom('invoice as i')
		.leftJoin(
			eb
				.selectFrom('invoice_line')
				.select(['invoice_id', (eb) => eb.fn.sum<NumericString>('amount').as('net')])
				.groupBy('invoice_id')
				.as('lt'),
			'lt.invoice_id',
			'i.id'
		)
		.leftJoin(taxes(rounding, places).as('tx'), 'tx.invoice_id', 'i.id')
		.leftJoin(
			eb
				.selectFrom('payment_allocation')
				.select(['invoice_id', (eb) => eb.fn.sum<NumericString>('amount').as('paid')])
				.groupBy('invoice_id')
				.as('a'),
			'a.invoice_id',
			'i.id'
		)
		.leftJoin(
			eb
				.selectFrom('credit_application')
				.select(['invoice_id', (eb) => eb.fn.sum<NumericString>('amount').as('credited')])
				.groupBy('invoice_id')
				.as('c'),
			'c.invoice_id',
			'i.id'
		)
		.select((eb) => {
			const net = sql`coalesce(${eb.ref('lt.net')}, 0)`;
			const tax = sql`coalesce(${eb.ref('tx.tax')}, 0)`;
			const paid = sql`coalesce(${eb.ref('a.paid')}, 0)`;
			const credited = sql`coalesce(${eb.ref('c.credited')}, 0)`;
			return [
				'i.id as invoice_id',
				'i.entity_id',
				'i.status',
				at(net).as('net'),
				at(tax).as('tax'),
				at(sql`${net} + ${tax}`).as('gross'),
				at(paid).as('paid'),
				at(credited).as('credited'),
				at(sql`greatest(${net} + ${tax} - ${paid} - ${credited}, 0)`).as('owed')
			];
		});
}
