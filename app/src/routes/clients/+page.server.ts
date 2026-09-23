import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Entities: the three things, and none owns another.
 *
 * A client is a business; a site is a place; a contact is a person. Two clients
 * can work at one address and each names it their own way, so the count beside
 * a client is that client's sites, not the address book's.
 */
export const load: PageServerLoad = async () => {
	const clients = await sql<
		{
			id: string;
			slug: string;
			name: string;
			active: boolean;
			contact: string | null;
			sites: string;
			site_labels: string | null;
			owed: string;
		}[]
	>`
		with owing as (
			select i.entity_id,
			       sum(il.amount + il.amount * il.tax_rate_pct / 100) as owed
			  from invoice i
			  join invoice_line il on il.invoice_id = i.id
			  left join payment_allocation pa on pa.invoice_id = i.id
			 where i.status = 'sent' and pa.id is null
			 group by i.entity_id
		)
		select e.id, e.slug, e.name, e.active,
		       (select c.name from entity_contact ec join contact c on c.id = ec.contact_id
		         where ec.entity_id = e.id and ec.is_primary limit 1) as contact,
		       count(si.id)::text as sites,
		       string_agg(si.display, ' · ' order by si.display) as site_labels,
		       coalesce(o.owed, 0)::text as owed
		  from entity e
		  left join site si on si.entity_id = e.id and si.active
		  left join owing o on o.entity_id = e.id
		 group by e.id, e.slug, e.name, e.active, o.owed
		 order by e.active desc, e.name`;

	// Every site has a rate; what varies is how long ago CDTFA was asked.
	const [counts] = await sql<{ contacts: string; unpriced: string }[]>`
		select (select count(*) from contact)::text as contacts,
		       (select count(*) from site s
		          join site_rate sr on sr.site_id = s.id
		         where s.active and sr.stale)::text as unpriced`;

	return { clients, counts };
};
