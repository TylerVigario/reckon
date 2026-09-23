import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { findClient } from '$lib/server/find';
import type { PageServerLoad } from './$types';

/**
 * One client: what they owe, what they have agreed to, and where they are.
 *
 * The tax rate shown is the rate at their site, not a property of the client.
 * A client is not a place -- two clients can work at one address, and one
 * client can work in two districts.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { id } = await findClient(params.id);

	const [client] = await sql<
		{
			id: string;
			slug: string;
			version: string;
			name: string;
			active: boolean;
			terms: number | null;
			payment_method: string | null;
			tax_exempt: boolean;
			certificate: string | null;
			expires_on: string | null;
			contact: string | null;
			owed: string;
			out: string;
			credit: string;
			rules: string | null;
		}[]
	>`
		with owing as (
			select i.entity_id,
			       sum(il.amount + il.amount * il.tax_rate_pct / 100) as owed,
			       count(distinct i.id) as out
			  from invoice i
			  join invoice_line il on il.invoice_id = i.id
			  left join payment_allocation pa on pa.invoice_id = i.id
			 where i.status = 'sent' and pa.id is null
			 group by i.entity_id
		)
		select e.id, e.slug, e.name, e.active, e.xmin::text as version,
		       coalesce(e.terms_days, (select default_terms_days from operator)) as terms,
		       e.payment_method, e.tax_exempt,
		       e.exemption_certificate as certificate,
		       e.exemption_expires_on::text as expires_on,
		       (select c.name from entity_contact ec join contact c on c.id = ec.contact_id
		         where ec.entity_id = e.id and ec.is_primary limit 1) as contact,
		       coalesce(o.owed, 0)::text as owed,
		       coalesce(o.out, 0)::text as out,
		       coalesce((select sum(cn.amount) - coalesce(sum(ca.amount), 0)
		                   from credit_note cn
		                   left join credit_application ca on ca.credit_note_id = cn.id
		                  where cn.entity_id = e.id), 0)::text as credit,
		       (select tax_rule_set from operator) as rules
		  from entity e
		  left join owing o on o.entity_id = e.id
		 where e.id = ${id}`;

	if (!client) error(404, 'no such client');

	// The client page says how many places and roughly where; the sites page
	// says everything else. A list of addresses inside a list of standing terms
	// was two subjects in one column, and the addresses lost.
	const [sites] = await sql<
		{ n: number; towns: string | null; unchecked: number; miles: string | null }[]
	>`
		select count(*)::int as n,
		       string_agg(distinct coalesce(si.city, si.label), ', ') as towns,
		       count(*) filter (where sr.stale)::int as unchecked,
		       max(si.round_trip_miles)::text as miles
		  from site si
		  left join site_rate sr on sr.site_id = si.id
		 where si.entity_id = ${id} and si.active`;

	const levies = await sql<
		{
			name: string;
			rate_pct: string | null;
			state_rate_pct: string;
			district_rate_pct: string;
			sites: string;
			priced_on: string | null;
			stale: boolean;
		}[]
	>`
		select sr.tax_jurisdiction as name,
		       max(sr.rate_pct)::text as rate_pct,
		       max(sr.state_rate_pct)::text as state_rate_pct,
		       max(sr.district_rate_pct)::text as district_rate_pct,
		       count(*)::text as sites,
		       max(sr.verified_on)::text as priced_on,
		       bool_or(sr.stale) as stale
		  from site si
		  join site_rate sr on sr.site_id = si.id
		 where si.entity_id = ${id} and si.active
		 group by 1
		 order by 1`;

	const [agreement] = await sql<
		{ price: string; basis: string; allotment: string; interval: string; hours: string | null }[]
	>`
		select a.price::text, a.basis, a.remote_allotment as allotment,
		       a.billing_interval as interval, a.remote_cap_hours::text as hours
		  from agreement a
		 where a.entity_id = ${id}
		   and (a.ends_on is null or a.ends_on >= current_date)
		 order by a.starts_on desc limit 1`;

	const recent = await sql<
		{ id: string; number: string; status: string; gross: string; on: string | null }[]
	>`
		select i.id, i.number, i.status,
		       coalesce(sum(il.amount + il.amount * il.tax_rate_pct / 100), 0)::text as gross,
		       coalesce(i.sent_at::date, i.created_at::date)::text as "on"
		  from invoice i
		  left join invoice_line il on il.invoice_id = i.id
		 where i.entity_id = ${id}
		 group by i.id, i.number, i.status, i.sent_at, i.created_at
		 order by coalesce(i.sent_at, i.created_at) desc
		 limit 5`;

	return { client, sites, levies, agreement, recent };
};
