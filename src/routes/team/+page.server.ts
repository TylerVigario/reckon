import { asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { passkey, role, session, user } from '#lib/server/db/schema/index.ts';
import { signingIn } from '#lib/server/links.ts';
import { passkeyName } from '#lib/server/passkeys.ts';
import type { PageServerLoad } from './$types';

/**
 * Everyone who signs in, or did: who they are, what they are paid as and what
 * they can reach, and whether they still sign in. Each opens their own page,
 * where all of it is changed. What anyone is paid is each service's, and is
 * not here.
 *
 * AND WHAT ANYONE CHECKING ACCESS READS (12 November 2026): when each last
 * signed in, their passkeys and where each is kept, and how many sessions they
 * have open. Reviewing access is the business's to do, by looking here (SOC 2
 * CC6.2, CC6.3); reckon keeps no record that someone looked, as GitHub keeps
 * none of its own: it shows who has access, and its audit log what changed.
 */
export const load: PageServerLoad = async () => {
	const [people, [{ roles }], keys, open] = await Promise.all([
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
			.groupBy(session.userId)
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
		roles
	};
};
