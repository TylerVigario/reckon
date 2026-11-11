import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { role } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * One person's details (the layout loads who they are): the roles they can
 * be paid as, to choose from. Who they are, what they can reach, the role they
 * are paid as, and whether they sign in are each changed here, and nowhere
 * else. What they are owed is the pay report's, and is a link from here.
 */
export const load: PageServerLoad = async () => ({
	roles: await db
		.select({ id: role.id, name: role.name, pays_as: role.paysAs })
		.from(role)
		.orderBy(asc(role.name))
});
