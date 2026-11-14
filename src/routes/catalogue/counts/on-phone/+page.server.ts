import { asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { materialFigures } from '#lib/server/stock.ts';
import type { PageServerLoad } from './$types';

/**
 * A count started on this phone with no signal: the sheet it is counted on --
 * every material offered, and any retired one with stock still on the shelf,
 * with what is on hand -- kept for no signal (#lib/offline-copy), quantities
 * alone. The count itself is the phone's, read from its queue.
 */
export const load: PageServerLoad = async () => {
	const materials = await db
		.select({
			id: t.material.id,
			name: t.material.name,
			// How its unit is written beside a figure: "ft", or the name.
			unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
			places: t.unit.places,
			active: t.material.active
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.orderBy(asc(t.material.name));
	const figures = await materialFigures(materials.map((m) => m.id));
	return {
		as_of: new Date().toISOString(),
		sheet: materials
			.map((m) => ({ ...m, on_hand: figures.of.get(m.id)!.on_hand }))
			.filter((m) => m.active || Number(m.on_hand) > 0)
	};
};
