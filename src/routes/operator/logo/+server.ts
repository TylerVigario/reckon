import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';

/** The operator's logo, straight out of the row that holds it. */
export const GET: RequestHandler = async () => {
	const row = await db
		.selectFrom('operator')
		.select(['logo', 'logo_media_type'])
		.limit(1)
		.executeTakeFirst();
	if (!row?.logo) error(404, 'no logo set');
	return new Response(new Uint8Array(row.logo), {
		headers: {
			'content-type': row.logo_media_type ?? 'image/png',
			// Private: one operator, one browser. Short, so a new logo shows up.
			'cache-control': 'private, max-age=60'
		}
	});
};
