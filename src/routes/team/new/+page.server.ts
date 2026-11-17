import { db } from '#lib/server/db/index.ts';
import { cannotSend } from '#lib/server/links.ts';
import type { PageServerLoad } from './$types';

/**
 * Adding a person: the roles they could be paid as, and what reckon is missing
 * to send them their invitation, if anything -- without which nobody is added.
 */
export const load: PageServerLoad = async () => ({
	roles: await db.selectFrom('role').select(['id', 'name']).orderBy('name').execute(),
	cannotSend: cannotSend()
});
