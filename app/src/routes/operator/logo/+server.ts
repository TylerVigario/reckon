import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** The operator's logo, straight out of the row that holds it. */
export const GET: RequestHandler = async () => {
	const [row] = await sql<
		// Uint8Array<ArrayBuffer>, not the looser ArrayBufferLike: a Response
		// body takes a view over a real ArrayBuffer, which is what postgres.js
		// returns for bytea.
		{ logo: Uint8Array<ArrayBuffer> | null; logo_media_type: string | null }[]
	>`select logo, logo_media_type from operator limit 1`;
	if (!row?.logo) error(404, 'no logo set');
	return new Response(row.logo, {
		headers: {
			'content-type': row.logo_media_type ?? 'image/png',
			// Private: one operator, one browser. Short, so a new logo shows up.
			'cache-control': 'private, max-age=60'
		}
	});
};
