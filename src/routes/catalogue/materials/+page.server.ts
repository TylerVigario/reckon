import { asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { materialFigures } from '#lib/server/stock.ts';
import type { PageServerLoad } from './$types';

/**
 * Materials: cost and tax stored apart.
 *
 * A lot records what was paid excluding tax, and the tax paid on it, as two
 * figures. Reg 1701 lets the tax already paid on goods that were resold come
 * off the measure -- which is only possible if the two were never added
 * together. Price is the ex-tax cost of one more plus markup, at the average
 * of what is on the shelf or the oldest lot's, as the business costs its stock
 * (#lib/stock-draw).
 */
export const load: PageServerLoad = async () => {
	const materials = await db
		.select({
			id: t.material.id,
			name: t.material.name,
			sku: t.material.sku,
			brand: t.material.brand,
			// How its unit is written beside a figure: "ft", or the name.
			unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
			active: t.material.active
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.orderBy(desc(t.material.active), asc(t.material.name));
	const [figures, [open], [last]] = await Promise.all([
		materialFigures(materials.map((m) => m.id)),
		// The count being counted, if one is, and how far it has got.
		db
			.select({
				id: t.stockCount.id,
				counted: sql<number>`(select count(*)::int from ${t.stockCountLine} l where l.count_id = stock_count.id)`
			})
			.from(t.stockCount)
			.where(isNull(t.stockCount.appliedAt)),
		db
			.select({ on: t.stockCount.countedOn })
			.from(t.stockCount)
			.where(isNotNull(t.stockCount.appliedAt))
			.orderBy(desc(t.stockCount.countedOn))
			.limit(1)
	]);
	return {
		open: open ?? null,
		lastCounted: last?.on ?? null,
		materials: materials.map((m) => ({ ...m, ...figures.of.get(m.id)! })),
		markup: figures.markup,
		costing: figures.costing
	};
};
