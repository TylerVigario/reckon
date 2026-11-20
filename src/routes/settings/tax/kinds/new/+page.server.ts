import { db } from '#lib/server/db/index.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import type { PageServerLoad } from './$types';

/** A new kind of sale: the states it is answered in, each one the business collects in. */
export const load: PageServerLoad = async () => ({ states: await collecting(db) });
