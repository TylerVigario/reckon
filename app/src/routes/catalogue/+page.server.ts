import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** What can go on a line: what is sold, what is stocked, what recurs. */
export const load: PageServerLoad = async () => {
	const [counts] = await sql<
		{
			services: string;
			unpriced: string;
			materials: string;
			out_of_stock: string;
			agreements: string;
			recurring: string;
		}[]
	>`
		select
		  (select count(*) from service where active)::text as services,
		  (select count(*) from service s
		    where s.active and not exists (
		      select 1 from service_price sp
		       where sp.service_id = s.id and sp.effective_from <= current_date))::text as unpriced,
		  (select count(*) from material where active)::text as materials,
		  (select count(*) from material m
		    where m.active and coalesce((select sum(qty_remaining) from material_lot ml
		                                  where ml.material_id = m.id), 0) <= 0)::text as out_of_stock,
		  (select count(*) from agreement
		    where ends_on is null or ends_on >= current_date)::text as agreements,
		  coalesce((select sum(price)::text from agreement
		             where (ends_on is null or ends_on >= current_date)
		               and billing_interval = 'monthly'), '0') as recurring`;

	return { counts };
};
