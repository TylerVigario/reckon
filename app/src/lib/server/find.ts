import { error } from '@sveltejs/kit';
import { sql } from './db';
import { UUID } from '$lib/field-rules';

/**
 * Resolves the thing a URL names.
 *
 * URLs carry slugs now, but an id still resolves -- a link somebody kept, a
 * row pasted out of psql, the id an invoice screen already had to hand. So
 * both work, and nothing that used to resolve has stopped.
 *
 * The slug is tried FIRST. A slug cannot be shaped like a UUID (the CHECK
 * keeps it to lowercase letters, digits and dashes, and a UUID has none of the
 * letters past f in it... which is not a guarantee), so asking the id question
 * of a slug-shaped string is the one that can never collide.
 */
/** Null rather than a throw, for callers that answer with a problem document. */
export async function lookUpClient(idOrSlug: string) {
	const [row] = await sql<{ id: string; slug: string }[]>`
		select id, slug from entity
		 where slug = ${idOrSlug}
		    or (${UUID.test(idOrSlug)} and id = ${UUID.test(idOrSlug) ? idOrSlug : null}::uuid)
		 limit 1`;
	return row ?? null;
}

export async function lookUpSite(clientId: string, idOrSlug: string) {
	const [row] = await sql<{ id: string; slug: string }[]>`
		select id, slug from site
		 where entity_id = ${clientId}
		   and (slug = ${idOrSlug}
		     or (${UUID.test(idOrSlug)} and id = ${UUID.test(idOrSlug) ? idOrSlug : null}::uuid))
		 limit 1`;
	return row ?? null;
}

export async function findClient(idOrSlug: string): Promise<{ id: string; slug: string }> {
	const [row] = await sql<{ id: string; slug: string }[]>`
		select id, slug from entity
		 where slug = ${idOrSlug}
		    or (${UUID.test(idOrSlug)} and id = ${UUID.test(idOrSlug) ? idOrSlug : null}::uuid)
		 limit 1`;
	if (!row) error(404, 'no such client');
	return row;
}

export async function findSite(
	clientId: string,
	idOrSlug: string
): Promise<{ id: string; slug: string }> {
	const [row] = await sql<{ id: string; slug: string }[]>`
		select id, slug from site
		 where entity_id = ${clientId}
		   and (slug = ${idOrSlug}
		     or (${UUID.test(idOrSlug)} and id = ${UUID.test(idOrSlug) ? idOrSlug : null}::uuid))
		 limit 1`;
	if (!row) error(404, 'no such site');
	return row;
}
