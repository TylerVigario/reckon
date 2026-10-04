import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { site } from '#lib/server/db/schema/index.ts';
import { operatorRow } from '#lib/server/operator.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { rateIsStale } from '#lib/server/stale.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// How current the rates are. There is nothing to configure -- every figure
	// comes from CDTFA's rate API -- so what a settings screen can usefully say
	// is whether anybody has asked lately.
	const [operator, [rates]] = await Promise.all([
		operatorRow(),
		db
			.select({
				sites: sql<string>`count(*)::text`,
				stale: sql<string>`(count(*) filter (where ${rateIsStale(site.areaVerifiedOn, businessToday())}))::text`,
				last: sql<string | null>`max(${site.areaVerifiedOn})::text`,
				oldest: sql<string | null>`min(${site.areaVerifiedOn})::text`
			})
			.from(site)
			.where(eq(site.active, true))
	]);
	return { operator, rates };
};
