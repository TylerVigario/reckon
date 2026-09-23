import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** People, who cross entities and locations both. */
export const load: PageServerLoad = async () => {
	const contacts = await sql<
		{
			id: string;
			name: string;
			email: string | null;
			phone: string | null;
			note: string | null;
			clients: string[];
			sites: string[];
			primary_for: string[];
		}[]
	>`
		select c.id, c.name, c.email, c.phone, c.note,
		       -- coalesce, not just array_remove: array_agg over no rows is NULL,
		       -- and a filtered aggregate matching nothing is exactly that case.
		       -- A contact who is nobody's primary handed the page a null to
		       -- call .includes() on.
		       coalesce(array_remove(array_agg(distinct e.name), null), '{}') as clients,
		       coalesce(array_remove(array_agg(distinct si.display), null), '{}') as sites,
		       coalesce(array_remove(array_agg(distinct e.name)
		                             filter (where ec.is_primary), null), '{}') as primary_for
		  from contact c
		  left join entity_contact ec on ec.contact_id = c.id
		  left join entity e on e.id = ec.entity_id
		  left join site_contact sc on sc.contact_id = c.id
		  left join site si on si.id = sc.site_id
		 group by c.id, c.name, c.email, c.phone, c.note
		 order by c.name`;

	return { contacts };
};
