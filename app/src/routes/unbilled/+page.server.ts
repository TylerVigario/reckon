import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Work done and not yet asked for.
 *
 * Today's tiles say how much and roughly how old. This says which -- because
 * the thing a reader does about an ageing figure is find the entry behind it,
 * and a bucket cannot be chased.
 *
 * Oldest first, always. The order is the argument: the top row is the one that
 * should already have gone out.
 *
 * TIME AND MILEAGE ARE PRICED THE SAME WAY, by entry_worth and leg_worth: at
 * what the service was worth on the day it was worked, the client's own price
 * before every client's, rounded to the service's increment and never below its
 * minimum. That is the rule an invoice line will use when it is drawn, so this
 * screen and the invoice it becomes cannot disagree. Pricing it at today's rate
 * would quietly re-price August.
 *
 * AN HOUR A RETAINER COVERS IS NOT HERE. The retainer has charged for it, so
 * there is nothing to ask for; only what falls past its allotment is.
 */
export const load: PageServerLoad = async () => {
	const work = await sql<
		{
			id: string;
			who: string;
			service: string;
			worked_by: string | null;
			crew: string;
			worked_on: string;
			site: string | null;
			hours: string;
			worth: string | null;
			heads: number;
			days: number;
		}[]
	>`
		select t.id,
		       e.name as who,
		       s.name as service,
		       u.name as worked_by,
		       t.crew,
		       t.worked_on::text,
		       si.display as site,
		       -- The hours still to be asked for: a retainer has charged for any
		       -- it covered.
		       ((t.minutes - coalesce(w.covered_minutes, 0)) / 60.0)::numeric(10,4)::text as hours,
		       w.billed::text as worth,
		       w.heads,
		       (current_date - t.worked_on)::int as days
		  from time_entry t
		  join service s on s.id = t.service_id
		  join entry_worth w on w.time_entry_id = t.id
		  join entity e on e.id = t.entity_id
		  left join app_user u on u.id = t.worked_by
		  left join site si on si.id = t.site_id
		 where t.billable
		   and (w.covered_minutes is null or w.covered_minutes < t.minutes)
		   and not exists (select 1 from invoice_line il where il.time_entry_id = t.id)
		 order by t.worked_on, e.name`;

	// Mileage by the day it was driven. One drive can carry legs for several
	// clients, and two drives on one day are one morning's driving -- so the day
	// is the row, and the trip screen is where it comes apart.
	const mileage = await sql<
		{
			travelled_on: string;
			trips: number;
			miles: string;
			worth: string | null;
			places: string | null;
			days: number;
		}[]
	>`
		select t.travelled_on::text,
		       count(distinct t.id)::int as trips,
		       sum(tl.miles)::text as miles,
		       sum(lw.billed)::text as worth,
		       (select string_agg(distinct coalesce(si.city, si.label, ts.address), ' and '
		                          order by coalesce(si.city, si.label, ts.address))
		          from trip_stop ts
		          left join site si on si.id = ts.site_id
		         where ts.trip_id in (select id from trip where travelled_on = t.travelled_on)
		       ) as places,
		       (current_date - t.travelled_on)::int as days
		  from trip t
		  join trip_leg tl on tl.trip_id = t.id
		  join leg_worth lw on lw.trip_leg_id = tl.id
		 where tl.entity_id is not null
		   and not exists (select 1 from invoice_line il where il.trip_leg_id = tl.id)
		 group by t.travelled_on
		 order by t.travelled_on`;

	// Not billable, and still worth counting. An hour given away is a decision,
	// and a decision nobody can see was never made.
	const given = await sql<
		{
			id: string;
			service: string;
			who: string | null;
			worked_by: string | null;
			worked_on: string;
			site: string | null;
			hours: string;
		}[]
	>`
		select t.id, s.name as service, e.name as who, u.name as worked_by,
		       t.worked_on::text, si.display as site,
		       (t.minutes / 60.0)::numeric(10,4)::text as hours
		  from time_entry t
		  join service s on s.id = t.service_id
		  left join entity e on e.id = t.entity_id
		  left join app_user u on u.id = t.worked_by
		  left join site si on si.id = t.site_id
		 where not t.billable
		   and t.worked_on >= date_trunc('month', current_date) - interval '1 month'
		 order by t.worked_on desc`;

	const [{ days: alertDays }] = await sql<{ days: number }[]>`
		select coalesce(ageing_alert_days, 21)::int as days from operator`;

	// A team entry records no one person -- the constraint forbids it, because
	// the whole point is that both went. So the names come from the team itself
	// rather than from the entry, and the row can still say who was there.
	const team = await sql<{ name: string }[]>`
		select name from app_user where active and role_id is not null order by name`;

	const total = [...work, ...mileage].reduce((n, r) => n + Number(r.worth ?? 0), 0).toFixed(2);
	const overdue =
		work.filter((w) => w.days > alertDays).length +
		mileage.filter((m) => m.days > alertDays).length;

	return { work, mileage, given, alertDays, total, overdue, team: team.map((t) => t.name) };
};
