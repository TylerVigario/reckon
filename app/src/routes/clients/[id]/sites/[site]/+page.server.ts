import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { findClient, findSite } from '$lib/server/find';
import type { PageServerLoad } from './$types';

/**
 * One site: what it is, what it charges, who to ask for, and what has happened
 * there.
 *
 * A site was a row in a list with nowhere to go. It is the thing a jobsite
 * rate, a mileage figure and a contact all hang off, and every one of those is
 * edited here -- except the rate, which is CDTFA's and has no field.
 */
export const load: PageServerLoad = async ({ params }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);

	const [site] = await sql<
		{
			id: string;
			entity_id: string;
			version: string;
			client_slug: string;
			slug: string;
			client: string;
			label: string;
			display: string;
			street: string;
			city: string;
			region: string;
			postcode: string;
			round_trip_miles: string | null;
			drive_minutes: number | null;
			active: boolean;
			rate_pct: string;
			state_rate_pct: string;
			district_rate_pct: string;
			jurisdiction: string;
			tax_area_code: string;
			verified_on: string;
			stale: boolean;
			changes: string;
		}[]
	>`
		select s.id, s.entity_id, s.xmin::text as version,
		       e.slug as client_slug, s.slug, e.name as client,
		       s.label, s.display,
		       s.street, s.city, s.region, s.postcode,
		       s.round_trip_miles::text, s.drive_minutes, s.active,
		       sr.rate_pct::text, sr.state_rate_pct::text, sr.district_rate_pct::text,
		       sr.tax_jurisdiction as jurisdiction, sr.tax_area_code,
		       sr.verified_on::text, sr.stale, sr.changes::text
		  from site s
		  join entity e on e.id = s.entity_id
		  join site_rate sr on sr.site_id = s.id
		 where s.id = ${found.id} and s.entity_id = ${client.id}`;
	if (!site) error(404, 'no such site');

	const people = await sql<
		{ id: string; name: string; email: string | null; phone: string | null; is_primary: boolean }[]
	>`
		select c.id, c.name, c.email, c.phone, sc.is_primary
		  from site_contact sc
		  join contact c on c.id = sc.contact_id
		 where sc.site_id = ${found.id}
		 order by sc.is_primary desc, c.name`;

	// The client's other people, offered before a new one is typed: creating a
	// second Uriel Paredes because nobody looked first is what a name match
	// cannot undo afterwards.
	const elsewhere = await sql<{ id: string; name: string }[]>`
		select c.id, c.name
		  from entity_contact ec
		  join contact c on c.id = ec.contact_id
		 where ec.entity_id = ${client.id}
		   and not exists (select 1 from site_contact sc
		                    where sc.site_id = ${found.id} and sc.contact_id = c.id)
		 order by c.name`;

	// Every answer CDTFA has given about this address.
	const checks = await sql<
		{
			id: string;
			on: string;
			rate_pct: string;
			jurisdiction: string | null;
			changed: boolean;
			note: string | null;
		}[]
	>`
		select id, checked_at::date::text as "on", rate_pct::text,
		       tax_jurisdiction as jurisdiction, changed, note
		  from site_tax_check
		 where site_id = ${found.id}
		 order by checked_at desc
		 limit 8`;

	const [worked] = await sql<{ entries: string; hours: string; last: string | null }[]>`
		select count(*)::text as entries,
		       coalesce(sum(minutes) / 60.0, 0)::numeric(10,2)::text as hours,
		       max(worked_on)::text as last
		  from time_entry where site_id = ${found.id}`;

	return { site, people, elsewhere, checks, worked };
};
