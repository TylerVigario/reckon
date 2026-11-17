import { db } from '#lib/server/db/index.ts';
import type { LayoutServerLoad } from './$types';

/** How many passkeys the person signed in has, for their Passkeys tab. */
export const load: LayoutServerLoad = async ({ locals }) => {
	const { passkeys } = await db
		.selectFrom('passkey')
		.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('passkeys'))
		.where('user_id', '=', locals.user!.id)
		.executeTakeFirstOrThrow();
	return { passkeys };
};
