import { sql } from '$lib/server/db';
import { anHourNow } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

/**
 * What can go on a line, what each of it is worth, and whom it pays.
 *
 * Every figure is computed in Postgres. Money is NUMERIC and stays a string all
 * the way out; what the business keeps is worked out by the same functions that
 * price and pay an entry -- billed_amount() and time_pay() -- so this screen
 * cannot tell a different story from the one an entry tells.
 */
export const load: PageServerLoad = async () => {
	const [services, prices, rules, covered, kept] = await Promise.all([
		sql<
			{
				id: string;
				name: string;
				unit: string;
				bill_to_nearest_seconds: number | null;
				minimum_charge: string | null;
				basis: string;
				hours: string | null;
				overage: string | null;
				period: string | null;
			}[]
		>`
			select id, name, unit, bill_to_nearest_seconds, minimum_charge,
			       subscription_basis as basis, subscription_hours as hours,
			       subscription_overage as overage, subscription_period as period
			  from service where active order by name`,

		// A price row's state, from its neighbours in the same scope: the one in
		// force, one waiting to start, or one a later row took over from -- which
		// can then say the period it was true for.
		sql<
			{
				id: string;
				service_id: string;
				client: string | null;
				rate: string;
				additional_rate: string;
				effective_from: string;
				until: string | null;
				state: 'current' | 'scheduled' | 'superseded';
			}[]
		>`
			select sp.id, sp.service_id, e.name as client,
			       sp.rate, sp.additional_rate, sp.effective_from::text,
			       (lead(sp.effective_from) over scope_by_date)::text as until,
			       case
			         when sp.effective_from > current_date then 'scheduled'
			         when sp.id = first_value(sp.id) over scope_in_force then 'current'
			         else 'superseded'
			       end as state
			  from service_price sp
			  left join entity e on e.id = sp.entity_id
			window scope_by_date as (partition by sp.service_id, sp.entity_id
			                         order by sp.effective_from),
			       scope_in_force as (partition by sp.service_id, sp.entity_id
			                          order by (sp.effective_from <= current_date) desc,
			                                   sp.effective_from desc)
			 order by sp.service_id, (sp.entity_id is not null), e.name, sp.effective_from desc`,

		// The same, for pay rules. A rule's scope is everything that makes it
		// more or less specific: whom it pays, for what, and for which client.
		sql<
			{
				id: string;
				service_id: string;
				payee: string;
				is_role: boolean;
				client: string | null;
				pays_for: 'time' | 'vehicle';
				method: 'per_hour' | 'percent' | 'fixed' | 'nothing';
				amount: string | null;
				effective_from: string;
				until: string | null;
				state: 'current' | 'scheduled' | 'superseded';
			}[]
		>`
			select pr.id, pr.service_id,
			       coalesce(r.name, u.name) as payee, pr.role_id is not null as is_role,
			       e.name as client, pr.pays_for, pr.method, pr.amount,
			       pr.effective_from::text,
			       (lead(pr.effective_from) over scope_by_date)::text as until,
			       case
			         when pr.effective_from > current_date then 'scheduled'
			         when pr.id = first_value(pr.id) over scope_in_force then 'current'
			         else 'superseded'
			       end as state
			  from pay_rule pr
			  left join role r on r.id = pr.role_id
			  left join app_user u on u.id = pr.user_id
			  left join entity e on e.id = pr.entity_id
			window scope_by_date as (partition by pr.service_id, pr.role_id, pr.user_id,
			                                      pr.entity_id, pr.pays_for
			                         order by pr.effective_from),
			       scope_in_force as (partition by pr.service_id, pr.role_id, pr.user_id,
			                                       pr.entity_id, pr.pays_for
			                          order by (pr.effective_from <= current_date) desc,
			                                   pr.effective_from desc)
			 order by pr.service_id, (pr.entity_id is not null), e.name,
			          (pr.user_id is not null), payee, pr.effective_from desc`,

		// A service an agreement names is not billed by the hour for that
		// client. The agreement says so, service by service, and it is joined
		// in here rather than stored twice.
		sql<
			{
				agreement_id: string;
				service_id: string;
				sites: string;
				allotment: 'capped' | 'unlimited';
				hours: string | null;
				basis: string;
				overage: string | null;
			}[]
		>`
			select asv.agreement_id, asv.service_id,
			       coalesce(string_agg(distinct si.display, ' and ' order by si.display),
			                e.name) as sites,
			       asv.allotment, asv.included_hours as hours,
			       asv.allotment_basis as basis, asv.overage
			  from agreement_service asv
			  join agreement a on a.id = asv.agreement_id
			  join entity e on e.id = a.entity_id
			  left join agreement_site ags on ags.agreement_id = a.id
			  left join site si on si.id = ags.site_id
			 where a.ends_on is null or a.ends_on >= current_date
			 group by asv.agreement_id, asv.service_id, e.name, asv.allotment,
			          asv.included_hours, asv.allotment_basis, asv.overage`,

		// What an hour leaves the business, worked out once for this screen and
		// the pay report alike.
		anHourNow()
	]);

	return {
		services: services.map((s) => ({
			...s,
			prices: prices.filter((p) => p.service_id === s.id),
			rules: rules.filter((r) => r.service_id === s.id),
			covered: covered.filter((c) => c.service_id === s.id),
			kept: kept.filter((k) => k.service_id === s.id && k.crew === 'one')
		}))
	};
};
