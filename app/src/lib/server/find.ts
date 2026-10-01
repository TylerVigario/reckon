import { error } from '@sveltejs/kit';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from './db';
import { entity, site } from './db/schema';
import { UUID } from '$lib/field-rules';

/**
 * Resolves the thing a URL names.
 *
 * URLs carry slugs, and an id resolves too -- a row pasted out of psql, the id
 * an invoice screen already has to hand. So both work. If a string is both one
 * row's slug and another's id, the slug wins: the rows are ordered with a slug
 * match first.
 */
const byIdToo = (column: typeof entity.id | typeof site.id, idOrSlug: string) =>
	UUID.test(idOrSlug) ? eq(column, idOrSlug) : undefined;

/** Null rather than a throw, for callers that answer with a problem document. */
export async function lookUpClient(idOrSlug: string) {
	const [row] = await db
		.select({ id: entity.id, slug: entity.slug })
		.from(entity)
		.where(or(eq(entity.slug, idOrSlug), byIdToo(entity.id, idOrSlug)))
		.orderBy(desc(sql`${entity.slug} = ${idOrSlug}`))
		.limit(1);
	return row ?? null;
}

export async function lookUpSite(clientId: string, idOrSlug: string) {
	const [row] = await db
		.select({ id: site.id, slug: site.slug })
		.from(site)
		.where(
			and(eq(site.entityId, clientId), or(eq(site.slug, idOrSlug), byIdToo(site.id, idOrSlug)))
		)
		.orderBy(desc(sql`${site.slug} = ${idOrSlug}`))
		.limit(1);
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
