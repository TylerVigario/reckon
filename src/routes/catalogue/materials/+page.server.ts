import { db } from '#lib/server/db/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { materialFigures } from '#lib/server/stock.ts';
import { isOfflineCopy } from '#lib/offline-copy.ts';
import { kindChoices } from '#lib/server/sale-kinds.ts';
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
export const load: PageServerLoad = async ({ url }) => {
	const materials = await db
		.selectFrom('material as m')
		.innerJoin('unit as u', 'u.id', 'm.unit_id')
		.select((eb) => [
			'm.id',
			'm.name',
			'm.sku',
			'm.brand',
			// How its unit is written beside a figure: "ft", or the name.
			eb.fn.coalesce('u.short', 'u.name').as('unit'),
			'm.active'
		])
		.orderBy('m.active', 'desc')
		.orderBy('m.name')
		.execute();
	const [figures, open, last] = await Promise.all([
		materialFigures(materials.map((m) => m.id)),
		// The count being counted, if one is, and how far it has got.
		db
			.selectFrom('stock_count as sc')
			.select((eb) => [
				'sc.id',
				eb
					.selectFrom('stock_count_line as l')
					.select((eb) => eb.cast<number>(eb.fn.countAll(), 'integer').as('n'))
					.whereRef('l.count_id', '=', 'sc.id')
					.$asScalar()
					.$notNull()
					.as('counted')
			])
			.where('sc.applied_at', 'is', null)
			.executeTakeFirst(),
		db
			.selectFrom('stock_count')
			.select('counted_on')
			.where('applied_at', 'is not', null)
			.orderBy('counted_on', 'desc')
			.limit(1)
			.executeTakeFirst()
	]);
	// Kept for no signal with quantities alone (#lib/offline-copy): what each
	// cost and sells at need a connection.
	const copy = isOfflineCopy(url);
	return {
		as_of: new Date().toISOString(),
		today: personalToday(),
		// What a change waiting on this phone made it, by name (#lib/StockOnPhone).
		kinds: await kindChoices(db),
		open: open ?? null,
		lastCounted: last?.counted_on ?? null,
		materials: materials.map((m) => {
			const f = figures.of.get(m.id)!;
			return copy
				? { ...m, ...f, ex_tax: null, tax_paid: null, price: null, listed: null }
				: { ...m, ...f };
		}),
		markup: copy ? null : figures.markup,
		costing: figures.costing
	};
};
