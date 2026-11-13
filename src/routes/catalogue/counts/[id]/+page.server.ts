import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { materialFigures } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One count. Being counted, it is a sheet: every material offered, and any
 * retired one with stock still on the shelf, with what is on hand now and
 * what was counted of each. Applied, it is what was counted, what the shelf
 * said then, and what each adjustment it made moved and was worth.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such count');
	const starter = alias(t.user, 'starter');
	const applier = alias(t.user, 'applier');
	const [count] = await db
		.select({
			id: t.stockCount.id,
			counted_on: t.stockCount.countedOn,
			by: starter.name,
			applied_at: t.stockCount.appliedAt,
			applied_by: applier.name
		})
		.from(t.stockCount)
		.innerJoin(starter, eq(starter.id, t.stockCount.createdBy))
		.leftJoin(applier, eq(applier.id, t.stockCount.appliedBy))
		.where(eq(t.stockCount.id, params.id));
	if (!count) error(404, 'no such count');

	const [materials, lines, adjustments] = await Promise.all([
		db
			.select({
				id: t.material.id,
				name: t.material.name,
				brand: t.material.brand,
				sku: t.material.sku,
				// How its unit is written beside a figure: "ft", or the name.
				unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
				places: t.unit.places,
				active: t.material.active
			})
			.from(t.material)
			.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
			.orderBy(asc(t.material.name)),
		db
			.select({
				material_id: t.stockCountLine.materialId,
				counted: t.stockCountLine.counted,
				on_hand: t.stockCountLine.onHand,
				cost_each: t.stockCountLine.costEach,
				by: t.user.name
			})
			.from(t.stockCountLine)
			.innerJoin(t.user, eq(t.user.id, t.stockCountLine.countedBy))
			.where(eq(t.stockCountLine.countId, count.id)),
		db
			.select({
				material_id: t.stockAdjustment.materialId,
				way: t.stockAdjustment.way,
				qty: t.stockAdjustment.qty,
				worth: sql<string>`(${t.stockAdjustment.exTaxCost} + ${t.stockAdjustment.taxPaid})::text`
			})
			.from(t.stockAdjustment)
			.where(eq(t.stockAdjustment.countId, count.id))
	]);
	const counted = new Set(lines.map((l) => l.material_id));
	const figures = await materialFigures(materials.map((m) => m.id));
	const sheet = materials
		.map((m) => ({ ...m, on_hand: figures.of.get(m.id)!.on_hand }))
		.filter((m) => m.active || Number(m.on_hand) > 0 || counted.has(m.id));
	return {
		count: { ...count, applied_at: count.applied_at?.toISOString() ?? null },
		sheet: count.applied_at ? sheet.filter((m) => counted.has(m.id)) : sheet,
		lines,
		adjustments
	};
};
