import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** An agreement's Charged tab: every period it has charged, newest first, or given freely. */
export const load: PageServerLoad = async ({ params }) => ({
	periods: await db
		.select({
			id: t.agreementPeriod.id,
			period_start: t.agreementPeriod.periodStart,
			period_end: t.agreementPeriod.periodEnd,
			amount: t.agreementPeriod.amount,
			given: t.agreementPeriod.given
		})
		.from(t.agreementPeriod)
		.where(eq(t.agreementPeriod.agreementId, params.id))
		.orderBy(desc(t.agreementPeriod.periodStart))
});
