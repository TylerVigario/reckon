import { businessToday, personalDay, businessDay } from '#lib/server/calendar.ts';
import { sql } from 'drizzle-orm';
import { Decimal, sumMoney } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import { moneyPlaces, taxRounding } from '#lib/server/business.ts';
import type { PageServerLoad } from './$types';

/**
 * Invoices: drafted, out, and recently settled.
 *
 * A total is the sum of its lines plus the tax each line carried when it was
 * billed -- never a live rate lookup. invoice_line stores the rate as applied,
 * so an invoice sent in June still says what June said.
 */
export const load: PageServerLoad = async () => {
	const [rounding, places] = await Promise.all([taxRounding(), moneyPlaces()]);
	const owing = balances(rounding, places);
	const i = t.invoice;
	const e = t.entity;
	const il = t.invoiceLine;
	const pa = t.paymentAllocation;
	const p = t.payment;

	const { rows } = await db.execute<{
		id: string;
		client_uuid: string | null;
		number: string;
		status: string;
		who: string;
		issued_on: string | null;
		due_on: string | null;
		sent_on: string | null;
		paid_on: string | null;
		terms: number | null;
		kinds: string | null;
		gross: string;
		owed: string;
		days_out: number | null;
		overdue: boolean;
	}>(sql`
		with kinds as (
			select ${il.invoiceId} as invoice_id,
			       string_agg(distinct ${il.kind}, ', ' order by ${il.kind}) as kinds
			  from ${il} group by 1
		),
		-- The day the last payment against it arrived.
		settled as (
			select ${pa.invoiceId} as invoice_id, max(${p.receivedOn}) as paid_on
			  from ${pa} join ${p} on ${p.id} = ${pa.paymentId}
			 group by 1
		)
		select ${i.id} as id, ${i.clientUuid} as client_uuid, ${i.number} as number,
		       ${i.status} as status, ${e.name} as who,
		       ${i.issuedOn}::text as issued_on, ${i.dueOn}::text as due_on,
		       ${personalDay(i.sentAt)}::text as sent_on,
		       s.paid_on::text as paid_on,
		       ${e.termsDays} as terms,
		       k.kinds,
		       b.gross::text as gross,
		       b.owed::text as owed,
		       case when ${i.sentAt} is not null
		            then (${businessToday()}::date - ${businessDay(i.sentAt)}) end as days_out,
		       (${i.dueOn} is not null and ${i.dueOn} < ${businessToday()}::date and b.owed > 0) as overdue
		  from ${i}
		  join ${e} on ${e.id} = ${i.entityId}
		  join ${owing} b on b.invoice_id = ${i.id}
		  left join kinds k on k.invoice_id = ${i.id}
		  left join settled s on s.invoice_id = ${i.id}
		 where ${i.status} <> 'void'
		 order by ${i.createdAt} desc`);

	const drafts = rows.filter((r) => r.status === 'draft');
	// Out is sent and not yet paid in full: a part-payment leaves the rest owed.
	const out = rows.filter((r) => r.status === 'sent' && Decimal.from(r.owed).gt(0));
	const paid = rows.filter((r) => r.paid_on !== null && Decimal.from(r.owed).isZero()).slice(0, 5);

	return {
		drafts,
		out,
		paid,
		totals: {
			owed: sumMoney(
				out.map((r) => r.owed),
				places
			),
			overdue: sumMoney(
				out.filter((r) => r.overdue).map((r) => r.owed),
				places
			),
			overdueCount: out.filter((r) => r.overdue).length,
			drafted: sumMoney(
				drafts.map((r) => r.gross),
				places
			)
		},
		// When this copy was made: shown when it is opened with no signal.
		as_of: new Date().toISOString()
	};
};
