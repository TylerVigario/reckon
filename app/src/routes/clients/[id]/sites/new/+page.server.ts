import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { entity } from '#lib/server/db/schema/index.ts';
import { findClient } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);
	const [client] = await db
		.select({ id: entity.id, slug: entity.slug, name: entity.name })
		.from(entity)
		.where(eq(entity.id, found.id));
	return { client };
};
