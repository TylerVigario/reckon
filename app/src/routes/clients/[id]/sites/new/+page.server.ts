import { sql } from '$lib/server/db';
import { findClient } from '$lib/server/find';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const found = await findClient(params.id);
	const [client] = await sql<{ id: string; slug: string; name: string }[]>`
		select id, slug, name from entity where id = ${found.id}`;
	return { client };
};
