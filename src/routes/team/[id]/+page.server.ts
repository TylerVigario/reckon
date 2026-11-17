import { db } from '#lib/server/db/index.ts';
import type { PageServerLoad } from './$types';

/**
 * One person's details (the layout loads who they are): the roles they can
 * be paid as, to choose from. Who they are, what they can reach, the role they
 * are paid as, and whether they sign in are each changed here, and nowhere
 * else. What they are owed is the pay report's, and is a link from here.
 */
export const load: PageServerLoad = async () => ({
	roles: await db.selectFrom('role').select(['id', 'name', 'pays_as']).orderBy('name').execute()
});
