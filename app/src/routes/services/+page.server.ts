import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * What can go on a line, and what each of it is worth.
 *
 * Every figure is computed in Postgres. Money is NUMERIC and stays a string all
 * the way out; multiplying a team rate or subtracting what is kept in
 * JavaScript is how cents go missing, and the two sit side by side where one
 * out would show.
 */
export const load: PageServerLoad = async () => {
	const rows = await sql<
		{
			id: string;
			name: string;
			unit: string;
			delivery: string | null;
			subscription_basis: string;
			subscription_hours: string | null;
			subscription_overage: string | null;
			subscription_period: string | null;
			price_id: string | null;
			crew: string | null;
			client: string | null;
			rate: string | null;
			effective_from: string | null;
			until: string | null;
			state: string | null;
			pays: string | null;
			keeps: string | null;
		}[]
	>`
		with priced as (
			select sp.*,
			       -- The day the next row for the same scope took over, so a
			       -- superseded row can say the period it was true for.
			       lead(sp.effective_from) over (
			         partition by sp.service_id, sp.entity_id, sp.crew
			         order by sp.effective_from) as until,
			       case
			         when sp.effective_from > current_date then 'scheduled'
			         when sp.id = first_value(sp.id) over (
			                partition by sp.service_id, sp.entity_id, sp.crew
			                order by (sp.effective_from <= current_date) desc,
			                         sp.effective_from desc)
			           then 'current'
			         else 'superseded'
			       end as state
			  from service_price sp
		)
		select s.id, s.name, s.unit, s.delivery,
		       s.subscription_basis, s.subscription_hours,
		       s.subscription_overage, s.subscription_period,
		       p.id as price_id, p.crew, e.name as client,
		       p.rate, p.effective_from::text, p.until::text, p.state,
		       -- A team rate is per hour of the job, not per person, so what it
		       -- pays out is the hourly pay twice over. Only for a service
		       -- measured in hours: an hourly pay rate has nothing to say about
		       -- a per-mile charge, and subtracting one from the other produced
		       -- a negative figure on screen.
		       case when s.unit <> 'hour' or pay.rate is null then null
		            when p.crew = 'team' then pay.rate * 2
		            else pay.rate end as pays,
		       case when s.unit <> 'hour' or pay.rate is null or p.rate is null
		              or p.state <> 'current' then null
		            when p.crew = 'team' then p.rate - pay.rate * 2
		            else p.rate - pay.rate end as keeps
		  from service s
		  left join priced p on p.service_id = s.id
		  left join entity e on e.id = p.entity_id
		  left join lateral (
		         -- A rate recorded against this service wins; a rate against no
		         -- service at all is the fallback for everything hourly.
		         select rate from person_pay_rate
		          where (service_id = s.id or service_id is null)
		            and effective_from <= current_date
		          order by (service_id is not null) desc, effective_from desc
		          limit 1
		       ) pay on true
		 where s.active
		 order by s.name, p.crew nulls first, p.effective_from desc`;

	// A site inside a retainer is not billed by the hour at all. That fact is
	// the agreement's, not a price row's -- so it is joined in here rather than
	// stored twice.
	const covered = await sql<
		{
			agreement_id: string;
			service_id: string;
			who: string;
			sites: string;
			allotment: string;
			responder: string | null;
		}[]
	>`
		select a.id as agreement_id,
		       s.id as service_id,
		       e.name as who,
		       coalesce(string_agg(distinct si.display, ' and '
		                           order by si.display), e.name) as sites,
		       a.remote_allotment as allotment,
		       a.responder_rate::text as responder
		  from agreement a
		  join entity e on e.id = a.entity_id
		  left join agreement_site ags on ags.agreement_id = a.id
		  left join site si on si.id = ags.site_id
		  join service s on s.delivery = 'remote'
		 where a.remote_allotment <> 'none'
		   and (a.ends_on is null or a.ends_on >= current_date)
		 group by a.id, s.id, e.name, a.remote_allotment, a.responder_rate`;

	const byService = new Map<string, Record<string, unknown>>();
	for (const r of rows) {
		let s = byService.get(r.id);
		if (!s) {
			s = {
				id: r.id,
				name: r.name,
				unit: r.unit,
				delivery: r.delivery,
				basis: r.subscription_basis,
				hours: r.subscription_hours,
				overage: r.subscription_overage,
				period: r.subscription_period,
				prices: [] as unknown[],
				covered: covered.filter((c) => c.service_id === r.id)
			};
			byService.set(r.id, s);
		}
		if (r.price_id)
			(s.prices as unknown[]).push({
				id: r.price_id,
				crew: r.crew,
				client: r.client,
				rate: r.rate,
				effective_from: r.effective_from,
				until: r.until,
				state: r.state,
				pays: r.pays,
				keeps: r.keeps
			});
	}

	return { services: [...byService.values()] };
};
