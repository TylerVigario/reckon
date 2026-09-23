import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Every draft, with what put it there.
 *
 * A draft is built but never sent: sending is a decision, and it is made here.
 * So each row has to carry enough to make that decision without opening it --
 * who it is for, who receives it, what tax it charges, what it is made of, and
 * whether the work on it has been waiting too long.
 *
 * Two things put a draft here and they are not the same urgency. A period
 * closing produces a draft on a schedule and can wait a day. Work ageing past
 * the operator's own alert figure cannot: that is money worked for and not
 * asked for, and the row says so in the loudest way the screen has.
 *
 * Every figure is Postgres'. Money is NUMERIC and stays a string the whole way
 * out -- the rows and the total sit on the same screen, where one cent out
 * would show.
 */
export const load: PageServerLoad = async () => {
	const drafts = await sql<
		{
			id: string;
			number: string;
			who: string;
			contact: string | null;
			area: string | null;
			rate_pct: string | null;
			made_of: string | null;
			period_end: string | null;
			oldest_worked_on: string | null;
			days_waiting: number | null;
			aged: boolean;
			lines: string;
			gross: string;
		}[]
	>`
		with alert as (
			select coalesce(ageing_alert_days, 21) as days from operator
		),
		money as (
			select il.invoice_id,
			       count(*)::text as lines,
			       sum(il.amount + il.amount * il.tax_rate_pct / 100)::text as gross
			  from invoice_line il group by il.invoice_id
		),
		-- What the invoice is made of, in the order a reader expects to meet it:
		-- the standing charge, then the work, then the driving, then the parts.
		-- Mileage is a service billed by the mile, which is why the unit decides
		-- it rather than the kind.
		made_of as (
			select invoice_id, string_agg(part, ', ' order by ord) as made_of
			  from (
			    select distinct il.invoice_id,
			           case when il.kind = 'recurring' then 1
			                when il.kind = 'service' and il.unit = 'mile' then 3
			                when il.kind = 'service' then 2
			                when il.kind = 'material' then 4
			                else 5 end as ord,
			           case when il.kind = 'recurring' then 'retainer'
			                when il.kind = 'service' and il.unit = 'mile' then 'mileage'
			                when il.kind = 'service' then 'labour'
			                when il.kind = 'material' then 'materials'
			                else 'an adjustment' end as part
			      from invoice_line il
			  ) p
			 group by invoice_id
		),
		-- The rate charged comes from where the work happened, so the name of
		-- the place that levies it is what identifies it on the row. The state's
		-- share is on every invoice and names nothing.
		where_taxed as (
			select il.invoice_id,
			       max(sr.rate_pct)::text as rate_pct,
			       min(sr.tax_jurisdiction) as area
			  from invoice_line il
			  join site_rate sr on sr.site_id = il.site_id
			 group by il.invoice_id
		),
		-- How long the oldest thing on it has been waiting. Time has a worked-on
		-- date of its own; a leg takes its trip's.
		waiting as (
			select il.invoice_id,
			       min(coalesce(te.worked_on, tr.travelled_on)) as oldest
			  from invoice_line il
			  left join time_entry te on te.id = il.time_entry_id
			  left join trip_leg tl on tl.id = il.trip_leg_id
			  left join trip tr on tr.id = tl.trip_id
			 group by il.invoice_id
		)
		select i.id, i.number, e.name as who,
		       c.name as contact,
		       w.area, w.rate_pct,
		       m.made_of,
		       i.period_end::text,
		       g.oldest::text as oldest_worked_on,
		       (current_date - g.oldest)::int as days_waiting,
		       coalesce(current_date - g.oldest > a.days, false) as aged,
		       coalesce(mo.lines, '0') as lines,
		       coalesce(mo.gross, '0') as gross
		  from invoice i
		  cross join alert a
		  join entity e on e.id = i.entity_id
		  left join entity_contact ec on ec.entity_id = e.id and ec.is_primary
		  left join contact c on c.id = ec.contact_id
		  left join money mo on mo.invoice_id = i.id
		  left join made_of m on m.invoice_id = i.id
		  left join where_taxed w on w.invoice_id = i.id
		  left join waiting g on g.invoice_id = i.id
		 where i.status = 'draft'
		 -- What has waited longest goes first: that is the one that should have
		 -- gone already.
		 order by (g.oldest is null), g.oldest, i.number`;

	const [{ days }] = await sql<{ days: number }[]>`
		select coalesce(ageing_alert_days, 21)::int as days from operator`;

	const total = drafts.reduce((n, d) => n + Number(d.gross), 0).toFixed(2);

	return { drafts, alertDays: days, total };
};
