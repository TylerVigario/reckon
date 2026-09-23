import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [operator] = await sql`select * from operator limit 1`;
	const [issued] = await sql<{ high: string }[]>`
		select coalesce(max(nullif(regexp_replace(number, '\D', '', 'g'), '')::bigint), 0)::text as high
		  from invoice`;
	return { operator: operator ?? null, issued: issued?.high ?? '0' };
};
