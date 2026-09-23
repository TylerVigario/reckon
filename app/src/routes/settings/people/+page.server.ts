import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Who works here, and what an hour pays them.
 *
 * A pay rate is (person?, service?, date) -> rate, most specific wins. Null on
 * either side means "anyone" or "any service", which is how both partners sit
 * on one rate today without that being baked into the shape.
 */
export const load: PageServerLoad = async () => {
	const people = await sql<
		{
			id: string;
			name: string;
			email: string;
			on_team: boolean;
			active: boolean;
			rate: string | null;
		}[]
	>`
		select u.id, u.name, u.email, u.on_team, u.active,
		       (select r.rate::text from person_pay_rate r
		         where (r.user_id = u.id or r.user_id is null)
		           and r.service_id is null
		           and r.effective_from <= current_date
		         order by (r.user_id is not null) desc, r.effective_from desc
		         limit 1) as rate
		  from app_user u
		 order by u.active desc, u.name`;

	const rates = await sql<
		{
			id: string;
			who: string | null;
			service: string | null;
			rate: string;
			effective_from: string;
		}[]
	>`
		select r.id, u.name as who, s.name as service, r.rate::text, r.effective_from::text
		  from person_pay_rate r
		  left join app_user u on u.id = r.user_id
		  left join service s on s.id = r.service_id
		 order by r.effective_from desc, u.name nulls first`;

	return { people, rates };
};
