import { sql } from '$lib/server/db';
import { pricesToday } from '$lib/server/prices';
import type { PageServerLoad } from './$types';

/**
 * Time: what is running, and what has been captured today.
 *
 * The running timer is NOT here. It lives in the browser's own storage, which
 * is what lets it survive a refresh in a shed with no reception -- the server
 * is told when the entry is posted, not while it is being timed. What this load
 * provides is the names and rates a timer needs in order to say what it is
 * timing, and everything already recorded today.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [{ today }] = await sql<{ today: string }[]>`select current_date::text as today`;

	const [month] = await sql<{ minutes: string }[]>`
		select coalesce(sum(minutes), 0)::text as minutes
		  from time_entry
		 where worked_on >= date_trunc('month', current_date)`;

	// Today's, newest first. A client's own name for the site, because that is
	// what the person who worked there calls it.
	const entries = await sql<
		{
			id: string;
			minutes: number;
			billable: boolean;
			note: string | null;
			crew: string;
			worked_by: string | null;
			entity: string | null;
			site: string | null;
			service: string;
			at: string;
			invoiced: boolean;
		}[]
	>`
		select t.id, t.minutes, t.billable, t.note, t.crew,
		       u.name as worked_by, e.name as entity,
		       si.display as site,
		       s.name as service,
		       to_char(t.created_at, 'HH24:MI') as at,
		       il.invoice_id is not null as invoiced
		  from time_entry t
		  left join app_user u on u.id = t.worked_by
		  join service s on s.id = t.service_id
		  left join entity e on e.id = t.entity_id
		  left join site si on si.id = t.site_id
		  left join invoice_line il on il.time_entry_id = t.id
		 where t.worked_on = current_date
		 order by t.created_at desc`;

	// What a timer needs to describe itself, and to price what it is timing.
	const [people, entities, services, prices] = await Promise.all([
		sql<{ id: string; name: string }[]>`
			select id, name from app_user where active and role_id is not null order by name`,
		sql<{ id: string; name: string; sites: { id: string; label: string }[] }[]>`select e.id, e.name,
		           coalesce(json_agg(json_build_object('id', si.id, 'label', si.display)
		                             order by si.display)
		                    filter (where si.id is not null), '[]') as sites
		      from entity e
		      left join site si on si.entity_id = e.id and si.active
		     where e.active group by e.id, e.name order by e.name`,
		sql<{ id: string; name: string; unit: string; bill_to_nearest_seconds: number | null }[]>`
			select id, name, unit, bill_to_nearest_seconds
			  from service where active and time_tracked order by name`,
		pricesToday()
	]);

	return {
		today,
		me: locals.user!.id,
		monthMinutes: Number(month.minutes),
		entries,
		people,
		entities,
		services,
		prices
	};
};
