import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * What an entry needs to be written down: who pays, where, what was done.
 *
 * The rate is resolved here for every (entity, crew) pair the page can offer,
 * so the figure updates as a choice is tapped rather than after a round trip.
 * "The rate resolves from the entity and the crew, not from the service" --
 * p8. Switching Worked by to Both moves an on-site hour from $80 to $130, and
 * seeing that happen is how a wrong entity is caught in the field instead of
 * on the invoice.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [{ today }] = await sql<{ today: string }[]>`select current_date::text as today`;

	const [people, entities, services, prices] = await Promise.all([
		sql<{ id: string; name: string }[]>`
			select id, name from app_user where active and on_team order by name`,
		sql<
			{
				id: string;
				name: string;
				sites: { id: string; label: string; rate_pct: string | null }[];
			}[]
		>`
			select e.id, e.name,
			       coalesce(json_agg(json_build_object(
			                  'id', si.id, 'label', si.display,
			                  'rate_pct', nullif(sr.rate_pct, 0))
			                ORDER BY si.display)
			                filter (where si.id is not null), '[]') as sites
			  from entity e
			  left join site si on si.entity_id = e.id and si.active
			  left join site_rate sr on sr.site_id = si.id
			 where e.active group by e.id, e.name order by e.name`,
		sql<{ id: string; name: string; unit: string; delivery: string | null }[]>`
			select id, name, unit, delivery from service
			 where active and time_tracked order by name`,
		// Every price in force today, so the page can resolve one without asking
		// again. Most specific wins: this client beats any client, this crew
		// beats any crew.
		sql<{ service_id: string; entity_id: string | null; crew: string | null; rate: string }[]>`
			select distinct on (service_id, entity_id, crew)
			       service_id, entity_id, crew, rate
			  from service_price
			 where effective_from <= current_date
			 order by service_id, entity_id, crew, effective_from desc`
	]);

	return { today, me: locals.user!.id, people, entities, services, prices };
};
