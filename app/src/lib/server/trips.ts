import { eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from './db';
import * as t from './db/schema';

/**
 * Where a trip went, by town: a trip is titled "Woodland and Elverta", not by
 * street. A trip belongs to the drive, not to any one client, so the place's
 * own name is used rather than a client's name for it.
 */
export const townsOf = (tripId: AnyPgColumn) =>
	sql<string | null>`(${db
		.select({
			towns: sql`string_agg(distinct coalesce(${t.site.city}, ${t.site.label}, ${t.tripStop.address}), ' and '
			                      order by coalesce(${t.site.city}, ${t.site.label}, ${t.tripStop.address}))`
		})
		.from(t.tripStop)
		.leftJoin(t.site, eq(t.site.id, t.tripStop.siteId))
		.where(eq(t.tripStop.tripId, tripId))})`;
