import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { role } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** Adding a person: the roles they could be paid as. */
export const load: PageServerLoad = async () => ({
	roles: await db.select({ id: role.id, name: role.name }).from(role).orderBy(asc(role.name))
});
