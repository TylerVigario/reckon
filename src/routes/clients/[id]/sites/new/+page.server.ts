import { db } from '#lib/server/db/index.ts';
import { findClient } from '#lib/server/find.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import type { PageServerLoad } from './$types';

/**
 * The client a site is made for, and where the business collects tax: in
 * California, where it does, CDTFA prices the site as it is made.
 */
export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);
	const client = await db
		.selectFrom('entity')
		.select(['id', 'slug', 'name'])
		.where('id', '=', found.id)
		.executeTakeFirstOrThrow();
	return { client, collects: await collecting(db) };
};
