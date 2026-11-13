import { error } from '@sveltejs/kit';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { UUID } from '#lib/field-rules.ts';
import { materialFigures } from '#lib/server/stock.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One material as a record: what it is, what is on hand and what it sells at,
 * and what one on the shelf costs now -- what its head says, and what Adjust
 * works from, whichever tab is open. Each tab loads its own part.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such material');
	const [found] = await db
		.select({
			id: t.material.id,
			name: t.material.name,
			sku: t.material.sku,
			brand: t.material.brand,
			// How its unit is written beside a figure: "ft", or the name.
			unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
			unit_id: t.material.unitId,
			places: t.unit.places,
			taxable: t.material.taxable,
			active: t.material.active,
			own_markup: t.material.markupPct,
			version: t.material.version
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.where(eq(t.material.id, params.id));
	if (!found) error(404, 'no such material');
	const [figures, [adjusted], [received]] = await Promise.all([
		materialFigures([found.id]),
		db
			.select({ n: count() })
			.from(t.stockAdjustment)
			.where(eq(t.stockAdjustment.materialId, found.id)),
		db.select({ n: count() }).from(t.materialLot).where(eq(t.materialLot.materialId, found.id))
	]);
	return {
		material: { ...found, ...figures.of.get(found.id)! },
		// The business's own markup, which one with none of its own sells at.
		markup: figures.markup,
		costing: figures.costing,
		adjusted: adjusted.n,
		// Whether any of it has been received: its unit is then fixed.
		received: received.n > 0,
		today: personalToday()
	};
};
