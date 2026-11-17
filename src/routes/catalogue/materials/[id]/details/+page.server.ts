import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/** A material's Details tab: the units it could be counted in, besides what its record says. */
export const load: PageServerLoad = async () => ({
	units: await db.selectFrom('unit').select(['id', 'name']).orderBy('name').execute()
});
