import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { UUID } from '#lib/field-rules.ts';
import { materialFigures } from '#lib/server/stock.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import type { LayoutServerLoad } from './$types';

/**
 * One material as a record: what it is, what is on hand and what it sells at,
 * and what one on the shelf costs now -- what its head says, and what Adjust
 * works from, whichever tab is open. Each tab loads its own part. Kept for no
 * signal with its Stock tab, so it is adjusted there.
 */
export const load: LayoutServerLoad = async ({ params, url }) => {
	if (!UUID.test(params.id)) error(404, 'no such material');
	const found = await db
		.selectFrom('material as m')
		.innerJoin('unit as u', 'u.id', 'm.unit_id')
		.select((eb) => [
			'm.id',
			'm.name',
			'm.sku',
			'm.brand',
			// How its unit is written beside a figure: "ft", or the name.
			eb.fn.coalesce('u.short', 'u.name').as('unit'),
			'm.unit_id',
			'u.places',
			'm.taxable',
			'm.active',
			'm.markup_pct as own_markup',
			'm.version'
		])
		.where('m.id', '=', params.id)
		.executeTakeFirst();
	if (!found) error(404, 'no such material');
	const [figures, adjusted, received] = await Promise.all([
		materialFigures([found.id]),
		db
			.selectFrom('stock_adjustment')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('material_id', '=', found.id)
			.executeTakeFirstOrThrow(),
		db
			.selectFrom('material_lot')
			.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
			.where('material_id', '=', found.id)
			.executeTakeFirstOrThrow()
	]);
	const copy = isOfflineCopy(url);
	const worth = figures.of.get(found.id)!;
	return {
		// Kept for no signal with quantities, and how it is priced -- the
		// business's markup, its own, or a set price -- which is changed there
		// (#lib/offline-copy). What it cost, and what that makes it sell at, need
		// a connection.
		copy,
		as_of: new Date().toISOString(),
		material: copy
			? { ...found, ...worth, ex_tax: null, tax_paid: null, price: null }
			: { ...found, ...worth },
		// The business's own markup, which one with none of its own sells at.
		markup: figures.markup,
		costing: figures.costing,
		adjusted: adjusted.n,
		// Whether any of it has been received: its unit is then fixed.
		received: received.n > 0,
		today: personalToday()
	};
};
