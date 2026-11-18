import { db } from '#lib/server/db/index.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import type { LayoutServerLoad } from './$types';

/**
 * Whether there is a Schedule A to show: it is California's return, so only
 * where the business collects tax in California.
 */
export const load: LayoutServerLoad = async () => ({
	scheduleA: (await collecting(db)).includes('CA')
});
