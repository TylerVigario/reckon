import { desc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { businessDay } from '#lib/server/calendar.ts';
import { findClient, findSite } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

/**
 * What CDTFA has said of a site: the latest answers it has given, and which
 * was its first, which has nothing before it to have moved from. Each is dated
 * by the business's day, as Last asked is (#lib/server/calendar).
 */
export const load: PageServerLoad = async ({ params }) => {
	const client = await findClient(params.id);
	const found = await findSite(client.id, params.site);
	const checks = await db
		.select({
			id: t.siteTaxCheck.id,
			on: sql<string>`${businessDay(t.siteTaxCheck.checkedAt)}::text`,
			rate_pct: t.siteTaxCheck.ratePct,
			jurisdiction: t.siteTaxCheck.taxJurisdiction,
			changed: t.siteTaxCheck.changed,
			note: t.siteTaxCheck.note,
			first: sql<boolean>`row_number() over (order by ${t.siteTaxCheck.checkedAt}, ${t.siteTaxCheck.id}) = 1`
		})
		.from(t.siteTaxCheck)
		.where(eq(t.siteTaxCheck.siteId, found.id))
		.orderBy(desc(t.siteTaxCheck.checkedAt))
		.limit(8);
	return { checks };
};
