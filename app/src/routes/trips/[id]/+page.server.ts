import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { UUID } from '$lib/field-rules';
import type { PageServerLoad } from './$types';

/**
 * One drive, and how its miles were handed to clients.
 *
 * The second tile is the point of the screen: what these legs bill, against
 * what a full round trip each would have billed. At Kettleman that is the
 * difference between 72.2 miles and 144.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such trip');

	const [trip] = await sql<
		{
			id: string;
			travelled_on: string;
			driver: string | null;
			stops: string | null;
			miles: string;
			billed: string;
			rate: string | null;
			round_trips: string | null;
		}[]
	>`
		with rate as (
			select sp.rate from service_price sp join service s on s.id = sp.service_id
			 where s.unit = 'mile' and sp.effective_from <= current_date
			 order by sp.effective_from desc limit 1
		)
		select t.id, t.travelled_on::text, u.name as driver,
		       (select string_agg(distinct coalesce(si.city, si.label, ts.address), ' and '
		                          order by coalesce(si.city, si.label, ts.address))
		          from trip_stop ts left join site si on si.id = ts.site_id
		         where ts.trip_id = t.id) as stops,
		       coalesce(sum(tl.miles), 0)::text as miles,
		       (coalesce(sum(tl.miles) filter (where tl.entity_id is not null), 0)
		        * (select rate from rate))::text as billed,
		       (select rate::text from rate) as rate,
		       -- What each client would have been charged driving out and back
		       -- alone, which is what most systems would have billed.
		       (select (sum(si.round_trip_miles) * (select rate from rate))::text
		          from (select distinct tl2.site_id from trip_leg tl2
		                 where tl2.trip_id = t.id and tl2.entity_id is not null) d
		          join site si on si.id = d.site_id) as round_trips
		  from trip t
		  left join app_user u on u.id = t.driven_by
		  left join trip_leg tl on tl.trip_id = t.id
		 where t.id = ${params.id}
		 group by t.id, t.travelled_on, u.name`;

	if (!trip) error(404, 'no such trip');

	const stops = await sql<{ seq: number; place: string; detail: string | null }[]>`
		select ts.seq,
		       coalesce(si.display, ts.address, 'Unrecorded') as place,
		       (select string_agg(distinct e.name, ' and ')
		          from trip_leg tl join entity e on e.id = tl.entity_id
		         where tl.trip_id = ts.trip_id and tl.site_id = ts.site_id) as detail
		  from trip_stop ts
		  left join site si on si.id = ts.site_id
		 where ts.trip_id = ${params.id}
		 order by ts.seq`;

	const legs = await sql<
		{
			id: string;
			seq: number;
			who: string | null;
			rule: string | null;
			miles: string;
			value: string;
		}[]
	>`
		with rate as (
			select sp.rate from service_price sp join service s on s.id = sp.service_id
			 where s.unit = 'mile' and sp.effective_from <= current_date
			 order by sp.effective_from desc limit 1
		)
		select tl.id, tl.seq, e.name as who, tl.rule,
		       tl.miles::text,
		       (tl.miles * (select rate from rate))::text as value
		  from trip_leg tl
		  left join entity e on e.id = tl.entity_id
		 where tl.trip_id = ${params.id}
		 order by tl.seq`;

	return { trip, stops, legs };
};
