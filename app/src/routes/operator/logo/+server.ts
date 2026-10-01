import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { operator } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/** The operator's logo, straight out of the row that holds it. */
export const GET: RequestHandler = async () => {
	const [row] = await db
		.select({ logo: operator.logo, mediaType: operator.logoMediaType })
		.from(operator)
		.limit(1);
	if (!row?.logo) error(404, 'no logo set');
	return new Response(new Uint8Array(row.logo), {
		headers: {
			'content-type': row.mediaType ?? 'image/png',
			// Private: one operator, one browser. Short, so a new logo shows up.
			'cache-control': 'private, max-age=60'
		}
	});
};
