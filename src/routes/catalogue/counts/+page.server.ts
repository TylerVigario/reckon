import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * Every count, the open one first, then newest: when, who, how many were
 * counted, and how many differences it put right, at what worth.
 */
export const load: PageServerLoad = async () => {
	const applier = alias(t.user, 'applier');
	return {
		counts: await db
			.select({
				id: t.stockCount.id,
				counted_on: t.stockCount.countedOn,
				by: t.user.name,
				applied_by: applier.name,
				open: sql<boolean>`${t.stockCount.appliedAt} is null`,
				counted: sql<number>`(select count(*)::int from ${t.stockCountLine} l where l.count_id = stock_count.id)`,
				differences: sql<number>`(select count(*)::int from ${t.stockAdjustment} a where a.count_id = stock_count.id)`,
				// Short is written off, over is found: what the count moved, each way.
				net: sql<string>`(select coalesce(sum(case when a.way = 'off' then -(a.ex_tax_cost + a.tax_paid) else a.ex_tax_cost + a.tax_paid end), 0)::text
				                   from ${t.stockAdjustment} a where a.count_id = stock_count.id)`
			})
			.from(t.stockCount)
			.innerJoin(t.user, eq(t.user.id, t.stockCount.createdBy))
			.leftJoin(applier, eq(applier.id, t.stockCount.appliedBy))
			.orderBy(
				sql`${t.stockCount.appliedAt} is null desc`,
				desc(t.stockCount.countedOn),
				desc(t.stockCount.createdAt)
			)
	};
};
