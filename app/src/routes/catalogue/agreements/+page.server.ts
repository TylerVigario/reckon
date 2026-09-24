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
			// What a period charges at the price: per site, times the sites.
			charge: string;
			site_count: number;
			// This period's charge, made in advance -- or given, or not made yet.
			now: { state: 'charged' | 'given' | 'uncharged'; amount: string | null };
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
		       (select string_agg(si.display, ' and ' order by si.display)
		          from agreement_site ags join site si on si.id = ags.site_id
		         where ags.agreement_id = a.id) as sites,
		       a.basis, a.price::text, agreement_charge(a.id)::text as charge,
		       (select count(*) from agreement_site s where s.agreement_id = a.id)::int as site_count,
		       coalesce((
		         select json_build_object(
		                  'state', case when ap.given then 'given' else 'charged' end,
		                  'amount', ap.amount::text)
		           from agreement_period ap
		          where ap.agreement_id = a.id
		            and current_date between ap.period_start and ap.period_end
		          limit 1), json_build_object('state', 'uncharged', 'amount', null)) as now,
		       a.billing_interval as interval,
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

	const recurring = live
		.filter((a) => a.interval === 'monthly')
		.reduce((n, a) => n + Number(a.charge), 0)
		.toFixed(2);

	return { live, recurring };
};
