import { count } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { role, user } from '#lib/server/db/schema/index.ts';
import { securityLog } from '#lib/server/security-log.ts';
import type { PageServerLoad } from './$types';

/**
 * Everyone's security log, for someone with Full: every sign-in, refusal,
 * passkey, link and change to who can reach what (#lib/server/security-log).
 * And the counts Team's other tabs carry.
 */
export const load: PageServerLoad = async ({ url }) => {
	const [log, [{ people }], [{ roles }]] = await Promise.all([
		securityLog('everyone', url.searchParams.get('before')),
		db.select({ people: count() }).from(user),
		db.select({ roles: count() }).from(role)
	]);
	return { ...log, people, roles };
};
