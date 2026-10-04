import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * The signed-in person's own profile: the zone they keep, and how their dates
 * and figures read. Theirs alone; /api/people refuses these fields for anyone
 * else. Each empty one follows the business's, or the locale's.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [me] = await db
		.select({
			timezone: user.timezone,
			locale: user.locale,
			hour_cycle: user.hourCycle,
			week_start: user.weekStart
		})
		.from(user)
		.where(eq(user.id, locals.user!.id));
	return { me, businessZone: locals.businessZone, businessLocale: locals.businessLocale };
};
