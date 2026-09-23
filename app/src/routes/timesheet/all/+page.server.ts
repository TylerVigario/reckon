import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Every entry in a month, by the week it was worked.
 *
 * Each is priced the way an invoice line will be: the most specific price row
 * that had taken effect on the day the work happened, never today's. A rate
 * that changed last week must not silently restate what a job in June was
 * worth.
 */
export const load: PageServerLoad = async ({ url }) => {
	// ?month=YYYY-MM, defaulting to this one. Parsed rather than interpolated.
	const asked = url.searchParams.get('month') ?? '';
	const month = /^\d{4}-\d{2}$/.test(asked) ? `${asked}-01` : null;

	const rows = await sql<
		{
			id: string;
			worked_on: string;
			week: string;
			minutes: number;
			billable: boolean;
			crew: string;
			note: string | null;
			worked_by: string | null;
			entity: string | null;
			site: string | null;
			service: string;
			delivery: string | null;
			value: string | null;
			invoiced: boolean;
			stale: boolean;
		}[]
	>`
		with bounds as (
			select coalesce(${month}::date, date_trunc('month', current_date)::date) as from_day
		)
		select t.id,
		       t.worked_on::text,
		       date_trunc('week', t.worked_on)::date::text as week,
		       t.minutes, t.billable, t.crew, t.note,
		       u.name as worked_by,
		       e.name as entity,
		       si.display as site,
		       s.name as service, s.delivery,
		       case when t.billable then (
		         t.minutes / 60.0 * (
		           select sp.rate from service_price sp
		            where sp.service_id = t.service_id
		              and sp.effective_from <= t.worked_on
		              and (sp.entity_id = t.entity_id or sp.entity_id is null)
		              and (sp.crew = t.crew or sp.crew is null)
		            order by (sp.entity_id is not null) desc,
		                     (sp.crew is not null) desc,
		                     sp.effective_from desc
		            limit 1))
		       end::text as value,
		       il.invoice_id is not null as invoiced,
		       (il.invoice_id is null and t.billable
		        and current_date - t.worked_on
		            > coalesce((select ageing_alert_days from operator), 21)) as stale
		  from time_entry t
		  cross join bounds b
		  left join app_user u on u.id = t.worked_by
		  join service s on s.id = t.service_id
		  left join entity e on e.id = t.entity_id
		  left join site si on si.id = t.site_id
		  left join invoice_line il on il.time_entry_id = t.id
		 where t.worked_on >= b.from_day
		   and t.worked_on < b.from_day + interval '1 month'
		 order by t.worked_on desc, t.created_at desc`;

	const [totals] = await sql<{ minutes: string; idle: string; month: string }[]>`
		with bounds as (
			select coalesce(${month}::date, date_trunc('month', current_date)::date) as from_day
		)
		select coalesce(sum(t.minutes), 0)::text as minutes,
		       coalesce(sum(t.minutes) filter (where not t.billable), 0)::text as idle,
		       to_char(b.from_day, 'FMMonth YYYY') as month
		  from bounds b
		  left join time_entry t
		         on t.worked_on >= b.from_day
		        and t.worked_on < b.from_day + interval '1 month'
		 group by b.from_day`;

	// One entry per week, newest first, so the page draws rather than regroups.
	const weeks: { week: string; rows: typeof rows }[] = [];
	for (const r of rows) {
		let w = weeks.find((x) => x.week === r.week);
		if (!w) weeks.push((w = { week: r.week, rows: [] as unknown as typeof rows }));
		(w.rows as unknown[]).push(r);
	}

	return { weeks, totals };
};
