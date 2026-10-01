import { sql } from 'drizzle-orm';
import * as t from './db/schema';

const i = t.invoice;
const il = t.invoiceLine;
const pa = t.paymentAllocation;

/**
 * Every invoice, what it comes to, and what is still to pay on it -- a subquery
 * to join or select from, with the columns invoice_id, entity_id, status,
 * gross, paid and owed.
 *
 * gross is the lines with the tax each carried, to the cent: what the invoice
 * asked for. owed is gross less what payments have been put against it, and
 * never below nothing, so a part-paid invoice is still owed its remainder and
 * an overpaid one is not owed a negative.
 *
 * Stated once, so the home page, the client list, a client's page and the
 * invoice list cannot disagree about what somebody owes.
 */
export const balances = sql`(
	select ${i.id} as invoice_id, ${i.entityId} as entity_id, ${i.status} as status,
	       round(coalesce(lt.gross, 0), 2) as gross,
	       coalesce(a.paid, 0) as paid,
	       greatest(round(coalesce(lt.gross, 0), 2) - coalesce(a.paid, 0), 0) as owed
	  from ${i}
	  left join (select ${il.invoiceId} as invoice_id,
	                    sum(${il.amount} + ${il.amount} * ${il.taxRatePct} / 100) as gross
	               from ${il} group by 1) lt on lt.invoice_id = ${i.id}
	  left join (select ${pa.invoiceId} as invoice_id, sum(${pa.amount}) as paid
	               from ${pa} group by 1) a on a.invoice_id = ${i.id}
)`;
