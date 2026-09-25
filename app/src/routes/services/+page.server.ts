import { sql } from '$lib/server/db';
import { anHourNow } from '$lib/server/reports';
import { prices, rules } from '$lib/server/catalogue';
import type { PageServerLoad } from './$types';

/**
 * What can go on a line, and what each of it is worth -- one row a service,
 * which opens onto the service itself.
 *
 * Every figure is computed in Postgres. Money is NUMERIC and stays a string all
 * the way out; what the business keeps is worked out by the same functions that
 * price and pay an entry -- billed_amount() and time_pay() -- so this screen
 * cannot tell a different story from the one an entry tells.
 */
export const load: PageServerLoad = async () => {
	const [services, priced, paying, covered, kept] = await Promise.all([
		sql<
			{
				id: string;
				name: string;
				unit: string;
				bill_to_nearest_seconds: number | null;
				minimum_charge: string | null;
				active: boolean;
			}[]
		>`
			select id, name, unit, bill_to_nearest_seconds, minimum_charge, active
			  from service order by active desc, name`,

		prices(),
		rules(),

		// A service an agreement names is not billed by the hour for that
		// client. The agreement says so, service by service, and it is joined
		// in here rather than stored twice.
		sql<
			{
				agreement_id: string;
				service_id: string;
				who: string;
				sites: string;
				allotment: 'capped' | 'unlimited';
				hours: string | null;
				basis: string;
				overage: string | null;
			}[]
		>`
			select asv.agreement_id, asv.service_id, e.name as who,
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
			// What is in force or about to be. What was is on the service's own
			// screen, and its history behind that.
			prices: priced.filter((p) => p.service_id === s.id && p.state !== 'superseded'),
			rules: paying.filter((r) => r.service_id === s.id && r.state !== 'superseded'),
			covered: covered.filter((c) => c.service_id === s.id),
			kept: kept.filter((k) => k.service_id === s.id && k.crew === 'one')
		}))
	};
};
