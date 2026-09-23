import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Invoices: drafted, out, and recently settled.
 *
 * A total is the sum of its lines plus the tax each line carried when it was
 * billed -- never a live rate lookup. invoice_line stores the rate as applied,
 * so an invoice sent in June still says what June said.
 */
type Row = {
	id: string;
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
	days_out: number | null;
	overdue: boolean;
};

export const load: PageServerLoad = async () => {
	const rows = await sql<Row[]>`
		with line_totals as (
			select invoice_id,
			       sum(amount + amount * tax_rate_pct / 100) as gross,
			       string_agg(distinct kind, ', ' order by kind) as kinds
			  from invoice_line group by invoice_id
		),
		settled as (
			select pa.invoice_id, max(p.received_on) as paid_on
			  from payment_allocation pa join payment p on p.id = pa.payment_id
			 group by pa.invoice_id
		)
		select i.id, i.number, i.status, e.name as who,
		       i.issued_on::text, i.due_on::text,
		       i.sent_at::date::text as sent_on,
		       s.paid_on::text,
		       e.terms_days as terms,
		       lt.kinds,
		       coalesce(lt.gross, 0)::text as gross,
		       case when i.sent_at is not null
		            then (current_date - i.sent_at::date) end as days_out,
		       (i.due_on is not null and i.due_on < current_date and s.paid_on is null) as overdue
		  from invoice i
		  join entity e on e.id = i.entity_id
		  left join line_totals lt on lt.invoice_id = i.id
		  left join settled s on s.invoice_id = i.id
		 where i.status <> 'void'
		 order by i.created_at desc`;

	const drafts = rows.filter((r) => r.status === 'draft');
	const out = rows.filter((r) => r.status === 'sent' && !r.paid_on);
	const paid = rows.filter((r) => r.paid_on).slice(0, 5);

	const sum = (list: Row[]) => list.reduce((n, r) => n + Number(r.gross), 0).toFixed(2);

	return {
		drafts,
		out,
		paid,
		totals: {
			owed: sum(out),
			overdue: sum(out.filter((r) => r.overdue)),
			overdueCount: out.filter((r) => r.overdue).length,
			drafted: sum(drafts)
		}
	};
};
