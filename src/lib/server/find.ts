import { error } from '@sveltejs/kit';
import { sql } from 'kysely';
import { db } from './db/index.ts';
import { UUID } from '#lib/field-rules.ts';

/**
 * Resolves the thing a URL names.
 *
 * URLs carry slugs, and an id resolves too -- a row pasted out of psql, the id
 * an invoice screen already has to hand. So both work. If a string is both one
 * row's slug and another's id, the slug wins: the rows are ordered with a slug
 * match first. Only a string shaped like an id is compared with one: anything
 * else is no uuid, and Postgres would refuse it.
 */

/** Null rather than a throw, for callers that answer with a problem document. */
export async function lookUpClient(idOrSlug: string) {
	const row = await db
		.selectFrom('entity')
		.select(['id', 'slug'])
		.where((eb) =>
			eb.or([eb('slug', '=', idOrSlug), ...(UUID.test(idOrSlug) ? [eb('id', '=', idOrSlug)] : [])])
		)
		.orderBy((eb) => sql`${eb.ref('slug')} = ${idOrSlug}`, 'desc')
		.limit(1)
		.executeTakeFirst();
	return row ?? null;
}

export async function lookUpSite(clientId: string, idOrSlug: string) {
	const row = await db
		.selectFrom('site')
		.select(['id', 'slug'])
		.where('entity_id', '=', clientId)
		.where((eb) =>
			eb.or([eb('slug', '=', idOrSlug), ...(UUID.test(idOrSlug) ? [eb('id', '=', idOrSlug)] : [])])
		)
		.orderBy((eb) => sql`${eb.ref('slug')} = ${idOrSlug}`, 'desc')
		.limit(1)
		.executeTakeFirst();
	return row ?? null;
}

export async function findClient(idOrSlug: string): Promise<{ id: string; slug: string }> {
	const row = await lookUpClient(idOrSlug);
	if (!row) error(404, 'no such client');
	return row;
}

export async function findSite(
	clientId: string,
	idOrSlug: string
): Promise<{ id: string; slug: string }> {
	const row = await lookUpSite(clientId, idOrSlug);
	if (!row) error(404, 'no such site');
	return row;
}
