import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [operator] = await sql`select * from operator limit 1`;
	// The mileage rate is a service price, dated, like every other price.
	const rates = await sql<{ id: string; rate: string; effective_from: string; current: boolean }[]>`
		select sp.id, sp.rate::text, sp.effective_from::text,
		       sp.id = first_value(sp.id) over (
		         order by (sp.effective_from <= current_date) desc,
		                  sp.effective_from desc) as current
		  from service_price sp join service s on s.id = sp.service_id
		 where s.unit = 'mile'
		 order by sp.effective_from desc`;
	return { operator: operator ?? null, rates };
};
