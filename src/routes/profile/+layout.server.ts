import { count, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { passkey } from '#lib/server/db/schema/index.ts';
import type { LayoutServerLoad } from './$types';

/** How many passkeys the person signed in has, for their Passkeys tab. */
export const load: LayoutServerLoad = async ({ locals }) => {
	const [{ passkeys }] = await db
		.select({ passkeys: count() })
		.from(passkey)
		.where(eq(passkey.userId, locals.user!.id));
	return { passkeys };
};
