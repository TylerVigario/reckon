import { sql } from 'drizzle-orm';
import { sumMoney } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { balances } from '#lib/server/balances.ts';
import type { PageServerLoad } from './$types';

/**
 * Every draft, with what put it there.
 *
 * Sending is a decision, and this is the screen it is meant to be made from,
 * so each row carries enough to make it without opening the draft -- who it is
 * for, who receives it, what tax it charges, what it is made of, and whether
 * the work on it has been waiting too long. Nothing builds or sends a draft
 * yet.
 *
 * Work ageing past the operator's own alert figure is the loud case: that is
 * money worked for and not asked for, and the row says so in the loudest way
 * the screen has.
 *
 * Each row's figures are Postgres', and the total is added exactly by
 * #lib/decimal. Money stays a string the whole way out -- the rows and the
 * total sit on the same screen, where one cent out would show.
 */
export const load: PageServerLoad = async () => {
	const i = t.invoice;
	const e = t.entity;
	const il = t.invoiceLine;
	const si = t.site;
	const ec = t.entityContact;
	const c = t.contact;
	const te = t.timeEntry;
	const tl = t.tripLeg;
	const tr = t.trip;

	const [[operator], { rows: drafts }] = await Promise.all([
		db.select({ days: t.operator.ageingAlertDays }).from(t.operator),
		db.execute<{
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
		}>(sql`
		with alert as (
			select coalesce((select ${t.operator.ageingAlertDays} from ${t.operator}), 30) as days
		),
		counted as (
			select ${il.invoiceId} as invoice_id, count(*)::text as lines from ${il} group by 1
		),
		-- What the invoice is made of, in the order a reader expects to meet it:
		-- the standing charge, then the work, then the driving, then the parts.
		-- Mileage is a service billed by the mile, which is why the unit decides
		-- it rather than the kind.
		made_of as (
			select invoice_id, string_agg(part, ', ' order by ord) as made_of
			  from (
			    select distinct ${il.invoiceId} as invoice_id,
			           case when ${il.kind} = 'recurring' then 1
			                when ${il.kind} = 'service' and ${il.unit} = 'mile' then 3
			                when ${il.kind} = 'service' then 2
			                when ${il.kind} = 'material' then 4
			                else 5 end as ord,
			           case when ${il.kind} = 'recurring' then 'retainer'
			                when ${il.kind} = 'service' and ${il.unit} = 'mile' then 'mileage'
			                when ${il.kind} = 'service' then 'labour'
			                when ${il.kind} = 'material' then 'materials'
			                else 'an adjustment' end as part
			      from ${il}
			  ) p
			 group by invoice_id
		),
		-- The rate charged comes from where the work happened, so the name of
		-- the place that levies it is what identifies it on the row. The state's
		-- share is on every invoice and names nothing.
		where_taxed as (
			select ${il.invoiceId} as invoice_id,
			       max(${si.taxRatePct})::text as rate_pct,
			       min(${si.taxJurisdiction}) as area
			  from ${il}
			  join ${si} on ${si.id} = ${il.siteId}
			 group by 1
		),
		-- How long the oldest thing on it has been waiting. Time has a worked-on
		-- date of its own; a leg takes its trip's.
		waiting as (
			select ${il.invoiceId} as invoice_id,
			       min(coalesce(${te.workedOn}, ${tr.travelledOn})) as oldest
			  from ${il}
			  left join ${te} on ${te.id} = ${il.timeEntryId}
			  left join ${tl} on ${tl.id} = ${il.tripLegId}
			  left join ${tr} on ${tr.id} = ${tl.tripId}
			 group by 1
		)
		select ${i.id} as id, ${i.number} as number, ${e.name} as who,
		       ${c.name} as contact,
		       w.area, w.rate_pct,
		       m.made_of,
		       ${i.periodEnd}::text as period_end,
		       g.oldest::text as oldest_worked_on,
		       (current_date - g.oldest)::int as days_waiting,
		       coalesce(current_date - g.oldest > a.days, false) as aged,
		       coalesce(n.lines, '0') as lines,
		       b.gross::text as gross
		  from ${i}
		  cross join alert a
		  join ${e} on ${e.id} = ${i.entityId}
		  join ${balances} b on b.invoice_id = ${i.id}
		  left join ${ec} on ${ec.entityId} = ${e.id} and ${ec.isPrimary}
		  left join ${c} on ${c.id} = ${ec.contactId}
		  left join counted n on n.invoice_id = ${i.id}
		  left join made_of m on m.invoice_id = ${i.id}
		  left join where_taxed w on w.invoice_id = ${i.id}
		  left join waiting g on g.invoice_id = ${i.id}
		 where ${i.status} = 'draft'
		 -- What has waited longest goes first: that is the one that should have
		 -- gone already.
		 order by (g.oldest is null), g.oldest, ${i.number}`)
	]);

	return { drafts, alertDays: operator?.days ?? 30, total: sumMoney(drafts.map((d) => d.gross)) };
};
