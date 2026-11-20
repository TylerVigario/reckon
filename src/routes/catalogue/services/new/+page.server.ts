import { db } from '#lib/server/db/index.ts';
import { kindChoices } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * New service: the kinds of sale it could be, offered ones, and when it was,
 * since it is kept for no signal (#lib/offline-copy) and says how old its copy
 * is.
 */
export const load: PageServerLoad = async () => ({
	kinds: (await kindChoices(db)).filter((k) => k.active),
	as_of: new Date().toISOString()
});
