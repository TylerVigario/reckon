import { asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { passkey, role, securityEvent, session, user } from '#lib/server/db/schema/index.ts';
import { record } from '#lib/server/events.ts';
import { signingIn } from '#lib/server/links.ts';
import { passkeyName } from '#lib/server/passkeys.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Everyone who signs in, or did: who they are, what they are paid as and what
 * they can reach, and whether they still sign in. Each opens their own page,
 * where all of it is changed. What anyone is paid is each service's, and is
 * not here.
 *
 * AND WHAT AN ACCESS REVIEW READS (12 November 2026): when each last signed
 * in, their passkeys and where each is kept, and how many sessions they have
 * open -- with when access was last marked reviewed, and by whom. Someone with
 * Full marks it when they have looked (SOC 2 CC6.2, CC6.3; PCI DSS 7.2.4 asks
 * every six months), and it is a row of the security log. Nothing reminds
 * them: ASVS 5.0 asks for no review at all.
 */
export const load: PageServerLoad = async () => {
	const [people, [{ roles }], keys, open, [reviewed]] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				active: user.active,
				access: user.access,
				last_signed_in_at: user.lastSignedInAt,
				...signingIn,
				role: role.name
			})
			.from(user)
			.leftJoin(role, eq(role.id, user.roleId))
			.orderBy(desc(user.active), asc(user.name)),
		db.select({ roles: count() }).from(role),
		db
			.select({ userId: passkey.userId, name: passkey.name, aaguid: passkey.aaguid })
			.from(passkey)
			.orderBy(asc(passkey.createdAt)),
		db
			.select({ userId: session.userId, sessions: count() })
			.from(session)
			.where(gt(session.expiresAt, sql`now()`))
			.groupBy(session.userId),
		db
			.select({ at: securityEvent.at, by: user.name })
			.from(securityEvent)
			.leftJoin(user, eq(user.id, securityEvent.userId))
			.where(eq(securityEvent.name, 'access_reviewed'))
			.orderBy(desc(securityEvent.at))
			.limit(1)
	]);
	// Each passkey by its name, or null where it has none to say where it is kept.
	const passkeysOf = new Map<string, (string | null)[]>();
	for (const k of keys)
		passkeysOf.set(k.userId, [...(passkeysOf.get(k.userId) ?? []), passkeyName(k)]);
	const sessionsOf = new Map(open.map((o) => [o.userId, o.sessions]));
	return {
		people: people.map((p) => ({
			...p,
			passkeys: passkeysOf.get(p.id) ?? [],
			sessions: sessionsOf.get(p.id) ?? 0
		})),
		roles,
		reviewed: reviewed ? { at: reviewed.at.toISOString(), by: reviewed.by } : null
	};
};

export const actions: Actions = {
	/** Access marked reviewed by whoever looked: a row of the security log, about them. */
	review: async ({ locals }) => {
		await record(db, 'access_reviewed', { user: locals.user!.id, by: null });
		return { reviewed: true };
	}
};
