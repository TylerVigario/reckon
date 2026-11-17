import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/** An agreement's Charged tab: every period it has charged, newest first, or given freely. */
export const load: PageServerLoad = async ({ params }) => ({
	periods: await db
		.selectFrom('agreement_period')
		.select(['id', 'period_start', 'period_end', 'amount', 'given'])
		.where('agreement_id', '=', params.id)
		.orderBy('period_start', 'desc')
		.execute()
});
