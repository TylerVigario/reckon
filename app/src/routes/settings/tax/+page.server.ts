import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [operator] = await sql`select * from operator limit 1`;
	// How current the rates are. There is nothing to configure -- every figure
	// comes from CDTFA's rate API -- so what a settings screen can usefully say
	// is whether anybody has asked lately.
	const [rates] = await sql<
		{ sites: string; stale: string; last: string | null; oldest: string | null }[]
	>`
		select count(*)::text as sites,
		       count(*) filter (where sr.stale)::text as stale,
		       max(sr.verified_on)::text as last,
		       min(sr.verified_on)::text as oldest
		  from site s join site_rate sr on sr.site_id = s.id
		 where s.active`;
	return { operator: operator ?? null, rates };
};
