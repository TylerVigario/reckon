import { sql } from '$lib/server/db';
import { findClient } from '$lib/server/find';
import type { PageServerLoad } from './$types';

/**
 * One client's places.
 *
 * A site was a handful of rows inside the client's standing terms, which put
 * two subjects in one column and lost the addresses. Here a site gets the room
 * to say what it is: where it is, what levies it and at what rate, how far it
 * is, and who to ask for when you get there.
 *
 * THE RATE IS THE SITE'S, NOT THE CLIENT'S, and it is CDTFA's rather than
 * anybody's here. One client can work in two counties, so there is no single
 * figure for the client -- this page is where that becomes obvious rather than
 * a footnote.
 */
export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);

	const [client] = await sql<{ id: string; slug: string; name: string }[]>`
		select id, slug, name from entity where id = ${found.id}`;

	const sites = await sql<
		{
			id: string;
			slug: string;
			label: string;
			address: string | null;
			rate_pct: string;
			state_rate_pct: string;
			district_rate_pct: string;
			jurisdiction: string;
			tax_area_code: string;
			stale: boolean;
			miles: string | null;
			minutes: number | null;
			verified_on: string | null;
			people: { name: string; is_primary: boolean }[];
			fallback: string | null;
			active: boolean;
		}[]
	>`
		select si.id, si.slug, si.display as label,
		       nullif(concat_ws(', ', si.street, si.city, si.region, si.postcode), '') as address,
		       sr.rate_pct::text,
		       sr.state_rate_pct::text,
		       sr.district_rate_pct::text,
		       sr.tax_jurisdiction as jurisdiction,
		       sr.tax_area_code,
		       coalesce(sr.stale, false) as stale,
		       si.round_trip_miles::text as miles,
		       si.drive_minutes as minutes,
		       si.area_verified_on::text as verified_on,
		       coalesce(people.list, '[]'::jsonb) as people,
		       fallback.name as fallback,
		       si.active
		  from site si
		  left join site_rate sr on sr.site_id = si.id
		  left join lateral (
		         select jsonb_agg(jsonb_build_object('name', c.name, 'is_primary', sc.is_primary)
		                          order by sc.is_primary desc, c.name) as list
		           from site_contact sc join contact c on c.id = sc.contact_id
		          where sc.site_id = si.id) people on true
		  left join lateral (
		         select c.name from entity_contact ec join contact c on c.id = ec.contact_id
		          where ec.entity_id = si.entity_id and ec.is_primary limit 1) fallback on true
		 where si.entity_id = ${found.id}
		 order by si.active desc, si.display`;

	return { client, sites };
};
