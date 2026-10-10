import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { formTerms } from '#lib/server/lines.ts';
import type { PageServerLoad } from './$types';

/**
 * Add a line to a draft started on this phone, before it has arrived. The
 * draft is the phone's to know (#lib/queue), so this is one screen for all of
 * them, kept for no signal, with every client's sites: the page shows the
 * draft's client's.
 */
export const load: PageServerLoad = async () => {
	const [sites, terms] = await Promise.all([
		db
			.select({
				id: t.site.id,
				entity_id: t.site.entityId,
				label: t.site.display,
				rate_pct: t.site.taxRatePct
			})
			.from(t.site)
			.where(eq(t.site.active, true))
			.orderBy(asc(t.site.display)),
		formTerms()
	]);
	return { sites, ...terms };
};
