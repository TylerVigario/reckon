import { db } from '#lib/server/db/index.ts';
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
		.selectFrom('material as m')
		.innerJoin('unit as u', 'u.id', 'm.unit_id')
		.select((eb) => [
			'm.id',
			'm.name',
			// How its unit is written beside a figure: "ft", or the name.
			eb.fn.coalesce('u.short', 'u.name').as('unit'),
			'u.places',
			'm.active'
		])
		.orderBy('m.name')
		.execute();
	const figures = await materialFigures(materials.map((m) => m.id));
	return {
		as_of: new Date().toISOString(),
		sheet: materials
			.map((m) => ({ ...m, on_hand: figures.of.get(m.id)!.on_hand }))
			.filter((m) => m.active || Number(m.on_hand) > 0)
	};
};
