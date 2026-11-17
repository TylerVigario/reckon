import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
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
	const [people, { roles }, keys, open] = await Promise.all([
		db
			.selectFrom('user')
			.leftJoin('role', 'role.id', 'user.role_id')
			.select((eb) => [
				'user.id',
				'user.name',
				'user.email',
				'user.active',
				'user.access',
				'user.last_signed_in_at',
				...signingIn(eb.ref('user.id'), eb.ref('user.email')),
				'role.name as role'
			])
			.orderBy('user.active', 'desc')
			.orderBy('user.name')
			.execute(),
		db
			.selectFrom('role')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('roles'))
			.executeTakeFirstOrThrow(),
		db.selectFrom('passkey').select(['user_id', 'name', 'aaguid']).orderBy('created_at').execute(),
		db
			.selectFrom('session')
			.select((eb) => ['user_id', eb.cast<number>(eb.fn.countAll(), 'integer').as('sessions')])
			.where('expires_at', '>', sql<Date>`now()`)
			.groupBy('user_id')
			.execute()
	]);
	// Each passkey by its name, or null where it has none to say where it is kept.
	const passkeysOf = new Map<string, (string | null)[]>();
	for (const k of keys)
		passkeysOf.set(k.user_id, [...(passkeysOf.get(k.user_id) ?? []), passkeyName(k)]);
	const sessionsOf = new Map(open.map((o) => [o.user_id, o.sessions]));
	return {
		people: people.map((p) => ({
			...p,
			passkeys: passkeysOf.get(p.id) ?? [],
			sessions: sessionsOf.get(p.id) ?? 0
		})),
		roles
	};
};
