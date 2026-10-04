import { sql, type SQL } from 'drizzle-orm';
import * as t from './db/schema/index.ts';
import { taxSql, type TaxRounding } from './tax-rules.ts';

const i = t.invoice;
const il = t.invoiceLine;
const pa = t.paymentAllocation;

/**
 * Every invoice, what it comes to, and what is still to pay on it -- a subquery
 * to join or select from, with the columns invoice_id, entity_id, status, net,
 * tax, gross, paid and owed.
 *
 * net is the lines; tax is what they carry, rounded as the business's tax rule
 * rounds it (#lib/server/tax-rules), to the currency's `places` (#lib/currency);
 * gross is the two together: what the invoice asks for. owed is gross less what
 * payments have been put against it, and never below nothing, so a part-paid
 * invoice is still owed its remainder and an overpaid one is not owed a
 * negative.
 *
 * Stated once, so the home page, the client list, a client's page, the invoice
 * list and an invoice itself cannot disagree about what somebody owes.
 */
export function balances(rounding: TaxRounding, places: number): SQL {
	// Each figure is a sum of amounts already at the currency's places, so this
	// rounds nothing: it writes every one to those places, "0" as "0.00".
	const at = (v: SQL) => sql`round(${v}, ${places}::int)`;
	return sql`(
	select ${i.id} as invoice_id, ${i.entityId} as entity_id, ${i.status} as status,
	       ${at(sql`coalesce(lt.net, 0)`)} as net,
	       ${at(sql`coalesce(tx.tax, 0)`)} as tax,
	       ${at(sql`coalesce(lt.net, 0) + coalesce(tx.tax, 0)`)} as gross,
	       ${at(sql`coalesce(a.paid, 0)`)} as paid,
	       ${at(sql`greatest(coalesce(lt.net, 0) + coalesce(tx.tax, 0) - coalesce(a.paid, 0), 0)`)} as owed
	  from ${i}
	  left join (select ${il.invoiceId} as invoice_id, sum(${il.amount}) as net
	               from ${il} group by 1) lt on lt.invoice_id = ${i.id}
	  left join ${taxSql(rounding, places)} tx on tx.invoice_id = ${i.id}
	  left join (select ${pa.invoiceId} as invoice_id, sum(${pa.amount}) as paid
	               from ${pa} group by 1) a on a.invoice_id = ${i.id}
)`;
}
