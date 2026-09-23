import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Trips for a month, billed or not.
 *
 * A trip is one drive; its legs are how that drive is handed to clients.
 * "Legs balanced" means the legs assigned add up to the miles driven -- the
 * guardrail that stops two nearby sites being charged a full round trip each,
 * which at Kettleman would bill 144 miles for 72.2 driven.
 */
export const load: PageServerLoad = async ({ url }) => {
	const asked = url.searchParams.get('month') ?? '';
	const month = /^\d{4}-\d{2}$/.test(asked) ? `${asked}-01` : null;

	const trips = await sql<
		{
			id: string;
			travelled_on: string;
			driver: string | null;
			stops: string | null;
			stop_count: number;
			clients: string | null;
			legs: number;
			miles: string;
			assigned: string;
			value: string | null;
			billed: boolean;
			balanced: boolean;
		}[]
	>`
		with bounds as (
			select coalesce(${month}::date, date_trunc('month', current_date)::date) as from_day
		),
		rate as (
			select sp.rate
			  from service_price sp join service s on s.id = sp.service_id
			 where s.unit = 'mile' and sp.effective_from <= current_date
			 order by sp.effective_from desc limit 1
		)
		select t.id, t.travelled_on::text, u.name as driver,
		       -- Where it went, by town: p3 titles a trip "Kettleman", not by
		       -- street. A trip belongs to the drive, not to any one client, so
		       -- the place's own name is used rather than a client's name for it.
		       (select string_agg(distinct coalesce(si.city, si.label, ts.address), ' and '
		                          order by coalesce(si.city, si.label, ts.address))
		          from trip_stop ts
		          left join site si on si.id = ts.site_id
		         where ts.trip_id = t.id) as stops,
		       (select count(*) from trip_stop ts where ts.trip_id = t.id)::int as stop_count,
		       (select string_agg(distinct e.name, ' then ' order by e.name)
		          from trip_leg tl join entity e on e.id = tl.entity_id
		         where tl.trip_id = t.id) as clients,
		       count(tl.id)::int as legs,
		       coalesce(sum(tl.miles), 0)::text as miles,
		       coalesce(sum(tl.miles) filter (where tl.entity_id is not null), 0)::text as assigned,
		       (coalesce(sum(tl.miles) filter (where tl.entity_id is not null), 0)
		        * (select rate from rate))::text as value,
		       bool_and(il.invoice_id is not null) filter (where tl.entity_id is not null) as billed,
		       -- Never more miles billed than were driven.
		       coalesce(sum(tl.miles) filter (where tl.entity_id is not null), 0)
		         <= coalesce(sum(tl.miles), 0) as balanced
		  from trip t
		  cross join bounds b
		  left join app_user u on u.id = t.driven_by
		  left join trip_leg tl on tl.trip_id = t.id
		  left join invoice_line il on il.trip_leg_id = tl.id
		 where t.travelled_on >= b.from_day
		   and t.travelled_on < b.from_day + interval '1 month'
		 group by t.id, t.travelled_on, u.name
		 order by t.travelled_on desc`;

	const [totals] = await sql<
		{ month: string; miles: string; trips: string; rate: string | null }[]
	>`
		with bounds as (
			select coalesce(${month}::date, date_trunc('month', current_date)::date) as from_day
		)
		select to_char(b.from_day, 'FMMonth YYYY') as month,
		       coalesce(sum(tl.miles), 0)::text as miles,
		       count(distinct t.id)::text as trips,
		       (select sp.rate::text from service_price sp join service s on s.id = sp.service_id
		         where s.unit = 'mile' and sp.effective_from <= current_date
		         order by sp.effective_from desc limit 1) as rate
		  from bounds b
		  left join trip t on t.travelled_on >= b.from_day
		                  and t.travelled_on < b.from_day + interval '1 month'
		  left join trip_leg tl on tl.trip_id = t.id
		 group by b.from_day`;

	return {
		unbilled: trips.filter((t) => !t.billed),
		billed: trips.filter((t) => t.billed),
		totals
	};
};
