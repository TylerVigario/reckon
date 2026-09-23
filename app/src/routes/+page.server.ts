import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Today: what is owed, what is ready, and what needs a decision.
 *
 * Every figure is computed in Postgres. Money is NUMERIC and stays a string all
 * the way to the page -- summing cents in JavaScript is how cents go missing,
 * and these figures sit next to each other where one out would show.
 *
 * The date comes from the database rather than from `new Date()`: the server's
 * clock is UTC and toISOString() west of Greenwich calls it tomorrow from five
 * in the afternoon.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [{ today }] = await sql<{ today: string }[]>`select current_date::text as today`;

	const [totals] = await sql<
		{
			owed: string;
			owed_count: string;
			drafts: string;
			draft_count: string;
			tax_held: string;
		}[]
	>`
		with line_totals as (
			select il.invoice_id,
			       sum(il.amount) as net,
			       sum(il.amount * il.tax_rate_pct / 100) as tax,
			       -- Reg 1701, where the operator has made that election: tax
			       -- already paid on resold goods never reaches the return.
			       sum(il.ex_tax_cost * il.tax_rate_pct / 100)
			         filter (where il.taxable
			                   and (select claims_tax_paid_purchases_resold from operator))
			         as credit
			  from invoice_line il group by il.invoice_id
		)
		select
		  coalesce(sum(lt.net + lt.tax) filter (where i.status = 'sent'), 0)::text  as owed,
		  count(*) filter (where i.status = 'sent')::text                           as owed_count,
		  coalesce(sum(lt.net + lt.tax) filter (where i.status = 'draft'), 0)::text as drafts,
		  count(*) filter (where i.status = 'draft')::text                          as draft_count,
		  -- Collected on somebody else's behalf, so the figure worth seeing is
		  -- what is STILL HELD: charged on what has gone out, less the Reg 1701
		  -- credit that comes off the return, less what has been handed to
		  -- CDTFA. Whether a return was paid is a fact about the world, not
		  -- something the invoices know, which is why it is subtracted from a
		  -- table rather than inferred.
		  (coalesce(sum(lt.tax) filter (where i.status in ('sent', 'paid')), 0)
		   - coalesce(sum(lt.credit) filter (where i.status in ('sent', 'paid')), 0)
		   - (select coalesce(sum(amount), 0) from tax_remittance))::text          as tax_held
		  from invoice i
		  left join line_totals lt on lt.invoice_id = i.id
		 where i.status in ('sent', 'draft')`;

	// Anything that cannot proceed until somebody decides. An invoice out past
	// the operator's own chase-after figure, and a site whose district is
	// unknown -- the second stops a return being computed at all.
	const decisions = await sql<
		{ kind: string; title: string; detail: string; amount: string | null; chip: string }[]
	>`
		with line_totals as (
			select invoice_id, sum(amount + amount * tax_rate_pct / 100) as gross
			  from invoice_line group by invoice_id
		)
		select * from (
		select 'invoice' as kind,
		       'Invoice ' || i.number || ' · ' || e.name as title,
		       'Sent ' || to_char(i.sent_at, 'FMDD Mon YYYY') || ', still unpaid.' as detail,
		       coalesce(lt.gross, 0)::text as amount,
		       'Unpaid ' || (current_date - i.sent_at::date) || ' days' as chip
		  from invoice i
		  join entity e on e.id = i.entity_id
		  left join line_totals lt on lt.invoice_id = i.id
		 where i.status = 'sent'
		   and i.sent_at is not null
		   and current_date - i.sent_at::date
		       > coalesce((select ageing_alert_days from operator), 21)
		union all
		select 'district',
		       e.name || ' · ' || s.display || ' · rate is old',
		       'CDTFA last priced this address on ' ||
		         to_char(sr.verified_on, 'FMDD Mon YYYY') || '. A district can be '
		         'added or ended in between, and every invoice since would be wrong.',
		       null,
		       (current_date - sr.verified_on) || ' days since CDTFA was asked'
		  from site s
		  join entity e on e.id = s.entity_id
		  join site_rate sr on sr.site_id = s.id
		 where s.active and sr.stale
		) d
		 -- Critical before warning. Sorting on the kind column put the district
		 -- first because 'd' precedes 'i', which is not a reason to show it
		 -- first. (No backticks in here: this is inside a template literal.)
		 order by case kind when 'invoice' then 0 else 1 end, title`;

	const drafts = await sql<
		{ id: string; number: string; who: string; lines: string; gross: string }[]
	>`
		select i.id, i.number, e.name as who,
		       count(il.id)::text as lines,
		       coalesce(sum(il.amount + il.amount * il.tax_rate_pct / 100), 0)::text as gross
		  from invoice i
		  join entity e on e.id = i.entity_id
		  left join invoice_line il on il.invoice_id = i.id
		 where i.status = 'draft'
		 group by i.id, i.number, e.name
		 order by i.created_at desc
		 limit 3`;

	// Work done and not yet put on an invoice, by how long it has waited.
	// Worth what entry_worth says it bills: the price in force on the day it was
	// worked, rounded to the service's increment and never below its minimum --
	// the same rule an invoice line will use when it is drawn.
	const ageing = await sql<{ bucket: string; n: string; worth: string; oldest: string | null }[]>`
		with unbilled as (
			select t.worked_on, w.billed
			  from time_entry t
			  join entry_worth w on w.time_entry_id = t.id
			 where t.billable
			   and not exists (select 1 from invoice_line il where il.time_entry_id = t.id)
		)
		select case
		         when current_date - worked_on <= 7  then '0–7 days'
		         when current_date - worked_on <= 30 then '8–30 days'
		         else '31+ days'
		       end as bucket,
		       count(*)::text as n,
		       coalesce(sum(billed), 0)::text as worth,
		       max(current_date - worked_on)::text as oldest
		  from unbilled
		 group by 1`;

	// Names for whatever the browser has a timer running against. The timer
	// itself is local -- it survives a refresh because it is written down in the
	// browser, not because the server was told -- so only the labels come from
	// here.
	const [entities, services] = await Promise.all([
		sql<{ id: string; name: string }[]>`select id, name from entity where active`,
		sql<{ id: string; name: string }[]>`select id, name from service where active`
	]);

	return {
		today,
		totals,
		decisions,
		drafts,
		ageing,
		names: {
			entity: Object.fromEntries(entities.map((e) => [e.id, e.name])),
			service: Object.fromEntries(services.map((s) => [s.id, s.name]))
		},
		me: locals.user!.id
	};
};
