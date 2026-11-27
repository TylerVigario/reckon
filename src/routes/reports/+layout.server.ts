import { db } from '#lib/server/db/index.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import { statesToFile } from '#lib/server/sales-tax.ts';
import type { LayoutServerLoad } from './$types';

/**
 * Which tax reports there are to show: Sales tax wherever there is a state
 * with tax to say anything of (#lib/server/sales-tax), and Schedule A, as it is
 * California's return, only where the business collects tax in California.
 */
export const load: LayoutServerLoad = async () => {
	const [states, collects] = await Promise.all([statesToFile(), collecting(db)]);
	return { salesTax: states.length > 0, scheduleA: collects.includes('CA') };
};
