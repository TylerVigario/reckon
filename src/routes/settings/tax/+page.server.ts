import { db } from '#lib/server/db/index.ts';
import { operatorRow } from '#lib/server/operator.ts';
import type { PageServerLoad } from './$types';

/**
 * Where the business collects tax, each state's registration as it says it,
 * and the year its returns are cut to. A rate is not one of them: a site's is
 * its area's, and in California CDTFA's (#lib/server/tax-registrations).
 */
export const load: PageServerLoad = async () => ({
	operator: await operatorRow(),
	registrations: await db
		.selectFrom('tax_registration')
		.select(['state', 'held', 'agency', 'filing_basis', 'claims_tax_paid_purchases_resold'])
		.orderBy('state')
		.execute()
});
