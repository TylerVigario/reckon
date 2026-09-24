import { sql } from './db';
import type { Price } from '$lib/rates';

/**
 * Every client each service has a price for today, with the rate for one person
 * and for the team.
 *
 * Both figures come from job_rate(), so a page chooses between them and never
 * works one out. A team is everybody holding a role -- the same count
 * entry_worth uses -- until entries name who worked.
 */
export function pricesToday() {
	return sql<Price[]>`
		with crew as (
		  select greatest(count(*), 1)::int as heads
		    from app_user where active and role_id is not null
		)
		select p.service_id, p.entity_id,
		       job_rate(p.service_id, p.entity_id, 1, current_date)::text as one,
		       job_rate(p.service_id, p.entity_id, crew.heads, current_date)::text as team
		  from (select distinct service_id, entity_id from service_price
		         where effective_from <= current_date) p, crew`;
}
