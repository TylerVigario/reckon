import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Recurring agreements: what each covers, service by service, and what it
 * meters.
 *
 * Hours used are derived from the entries themselves, never from a stored
 * counter -- a counter and the entries it counts eventually disagree, and the
 * entries are the record. Only hours on a service the agreement names count
 * against it: the agreement says what it covers, so nothing is inferred from
 * what kind of work it was.
 */
export const load: PageServerLoad = async () => {
	const live = await sql<
		{
			id: string;
			who: string;
			sites: string | null;
			basis: string;
			price: string;
			interval: string;
			agreed_with: string | null;
			anchor: number;
			covers: {
				service: string;
				allotment: 'capped' | 'unlimited';
				hours: string | null;
				overage: string | null;
				used: string;
			}[];
			// The rules that pay differently for this client than for any other --
			// the share of the retainer paid for covered time, and whatever else.
			pay: {
				service: string;
				payee: string;
				pays_for: string;
				method: string;
				amount: string | null;
			}[];
		}[]
	>`
		select a.id, e.name as who,
		       (select string_agg(si.display, ', ' order by si.display)
		          from agreement_site ags join site si on si.id = ags.site_id
		         where ags.agreement_id = a.id) as sites,
		       a.basis, a.price::text, a.billing_interval as interval,
		       c.name as agreed_with, a.billing_anchor_day as anchor,
		       coalesce((
		         select json_agg(json_build_object(
		                  'service', s.name,
		                  'allotment', al.allotment,
		                  'hours', al.pooled_hours::numeric(10,2)::text,
		                  'overage', al.overage,
		                  'used', coalesce((
		                     select sum(t.minutes) / 60.0 from time_entry t
		                      where t.entity_id = a.entity_id and t.service_id = al.service_id
		                        and t.worked_on >= date_trunc('month', current_date)), 0)
		                     ::numeric(10,2)::text)
		                order by s.name)
		           from agreement_allotment al
		           join service s on s.id = al.service_id
		          where al.agreement_id = a.id), '[]') as covers,
		       coalesce((
		         select json_agg(json_build_object(
		                  'service', cur.service, 'payee', cur.payee,
		                  'pays_for', cur.pays_for, 'method', cur.method, 'amount', cur.amount)
		                order by cur.service, cur.payee)
		           from (select distinct on (pr.service_id, pr.role_id, pr.user_id, pr.pays_for)
		                        s.name as service, coalesce(r.name, u.name) as payee,
		                        pr.pays_for, pr.method, pr.amount::text as amount
		                   from pay_rule pr
		                   join service s on s.id = pr.service_id
		                   left join role r on r.id = pr.role_id
		                   left join app_user u on u.id = pr.user_id
		                  where pr.entity_id = a.entity_id
		                    and pr.effective_from <= current_date
		                  order by pr.service_id, pr.role_id, pr.user_id, pr.pays_for,
		                           pr.effective_from desc) cur), '[]') as pay
		  from agreement a
		  join entity e on e.id = a.entity_id
		  left join contact c on c.id = a.contact_id
		 where a.ends_on is null or a.ends_on >= current_date
		 order by e.name`;

	// Everyone without an agreement falls back to whatever each service sold on
	// subscription includes.
	const subscriptions = await sql<
		{ id: string; name: string; basis: string; hours: string | null; period: string | null }[]
	>`
		select id, name, subscription_basis as basis,
		       subscription_hours::text as hours, subscription_period as period
		  from service
		 where active and subscription_basis <> 'none'
		 order by name`;

	const uncovered = await sql<{ id: string; name: string; used: Record<string, string> }[]>`
		select e.id, e.name,
		       coalesce((
		         select json_object_agg(t.service_id, t.hours::numeric(10,2)::text)
		           from (select t.service_id, sum(t.minutes) / 60.0 as hours
		                   from time_entry t
		                  where t.entity_id = e.id
		                    and t.worked_on >= date_trunc('month', current_date)
		                  group by t.service_id) t), '{}') as used
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

	return { live, uncovered, subscriptions, recurring };
};
