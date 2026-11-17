import { db } from '#lib/server/db/index.ts';
import { findClient } from '#lib/server/find.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);
	const client = await db
		.selectFrom('entity')
		.select(['id', 'slug', 'name'])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();
	return { client };
};
