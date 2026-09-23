import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Recurring agreements: what they cover, and what they meter.
 *
 * Hours used are derived from the entries themselves, never from a stored
 * counter -- a counter and the entries it counts eventually disagree, and the
 * entries are the record.
 */
export const load: PageServerLoad = async () => {
	const live = await sql<
		{
			id: string;
			who: string;
			sites: string | null;
			basis: string;
			allotment: string;
			cap: string | null;
			pooled: string | null;
			used: string;
			price: string;
			interval: string;
			responder: string | null;
			agreed_with: string | null;
			anchor: number;
		}[]
	>`
		select a.id, e.name as who,
		       string_agg(distinct si.display, ', ' order by si.display) as sites,
		       coalesce(a.allotment_basis, a.basis) as basis,
		       a.remote_allotment as allotment,
		       a.remote_cap_hours::text as cap,
		       al.pooled_hours::text as pooled,
		       coalesce((select sum(t.minutes) / 60.0
		                   from time_entry t join service s on s.id = t.service_id
		                  where t.entity_id = a.entity_id and s.delivery = 'remote'
		                    and t.worked_on >= date_trunc('month', current_date)), 0)::text as used,
		       a.price::text, a.billing_interval as interval,
		       a.responder_rate::text as responder,
		       c.name as agreed_with,
		       a.billing_anchor_day as anchor
		  from agreement a
		  join entity e on e.id = a.entity_id
		  join agreement_allotment al on al.agreement_id = a.id
		  left join contact c on c.id = a.contact_id
		  left join agreement_site ags on ags.agreement_id = a.id
		  left join site si on si.id = ags.site_id
		 where a.ends_on is null or a.ends_on >= current_date
		 group by a.id, e.name, a.allotment_basis, a.basis, a.remote_allotment,
		          a.remote_cap_hours, al.pooled_hours, a.entity_id, a.price,
		          a.billing_interval, a.responder_rate, c.name, a.billing_anchor_day
		 order by e.name`;

	// Everyone without an agreement falls back to whatever the service includes.
	const [fallback] = await sql<
		{ hours: string | null; overage: string | null; period: string | null }[]
	>`
		select subscription_hours::text as hours, subscription_overage as overage,
		       subscription_period as period
		  from service where delivery = 'remote' and subscription_basis = 'capped'
		 limit 1`;

	const uncovered = await sql<{ id: string; name: string; used: string }[]>`
		select e.id, e.name,
		       coalesce((select sum(t.minutes) / 60.0
		                   from time_entry t join service s on s.id = t.service_id
		                  where t.entity_id = e.id and s.delivery = 'remote'
		                    and t.worked_on >= date_trunc('month', current_date)), 0)::text as used
		  from entity e
		 where e.active
		   and not exists (select 1 from agreement a
		                    where a.entity_id = e.id
		                      and (a.ends_on is null or a.ends_on >= current_date))
		 order by e.name`;

	const recurring = live
		.filter((a) => a.interval === 'monthly')
		.reduce((n, a) => n + Number(a.price), 0)
		.toFixed(2);

	return { live, uncovered, fallback, recurring };
};
