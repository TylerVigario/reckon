import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { UUID } from '$lib/field-rules';
import { prices, rules } from '$lib/server/catalogue';
import { anHourNow } from '$lib/server/reports';
import type { PageServerLoad } from './$types';

/**
 * One service: what it is, what it charges, whom it pays -- and each of those
 * editable here.
 *
 * What is in force and what is scheduled are shown. What was is the service's
 * history, a tap away, so this screen says what is true now.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such service');

	const [service] = await sql<
		{
			id: string;
			name: string;
			unit: string;
			time_tracked: boolean;
			taxable: boolean;
			active: boolean;
			bill_to_nearest_seconds: number | null;
			minimum_charge: string | null;
		}[]
	>`
		select id, name, unit, time_tracked, taxable, active, bill_to_nearest_seconds,
		       minimum_charge
		  from service where id = ${params.id}`;
	if (!service) error(404, 'no such service');

	const [priced, paying, covered, hour, roles, people, clients, [{ today }], [used]] =
		await Promise.all([
			prices(service.id),
			rules(service.id),
			// The agreements that name this service: for those clients it is not
			// billed by the hour, and the price rows above are not what they pay.
			sql<{ agreement_id: string; who: string; allotment: string; hours: string | null }[]>`
			select a.id as agreement_id, e.name as who, al.allotment,
			       al.pooled_hours::numeric(10,2)::text as hours
			  from agreement_allotment al
			  join agreement a on a.id = al.agreement_id
			  join entity e on e.id = a.entity_id
			 where al.service_id = ${service.id}
			   and (a.ends_on is null or a.ends_on >= current_date)
			 order by e.name`,
			anHourNow(),
			// The role people hold first, so a new rule starts on the one in use.
			sql<{ id: string; name: string }[]>`
			select r.id, r.name from role r
			 order by (select count(*) from app_user u where u.role_id = r.id and u.active) desc,
			          r.name`,
			sql<{ id: string; name: string }[]>`
			select id, name from app_user where active order by name`,
			sql<{ id: string; name: string }[]>`
			select id, name from entity where active order by name`,
			sql<{ today: string }[]>`select current_date::text as today`,
			// What would stop it being deleted: the same three things the schema
			// refuses a delete over. Its own prices and rules do not count -- they
			// go with it.
			sql<{ entries: number; legs: number; agreements: number }[]>`
			select (select count(*) from time_entry where service_id = ${service.id})::int as entries,
			       (select count(*) from trip_leg where service_id = ${service.id})::int as legs,
			       (select count(*) from agreement_service where service_id = ${service.id})::int
			         as agreements`
		]);

	return {
		service,
		today,
		prices: priced.filter((p) => p.state !== 'superseded'),
		rules: paying.filter((r) => r.state !== 'superseded'),
		earlier:
			priced.filter((p) => p.state === 'superseded').length +
			paying.filter((r) => r.state === 'superseded').length,
		covered,
		hour: hour.filter((h) => h.service_id === service.id),
		roles,
		people,
		clients,
		used
	};
};
