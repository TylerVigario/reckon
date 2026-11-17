import { error } from '@sveltejs/kit';
import { sql } from 'kysely';
import { db } from '#lib/server/db/index.ts';
import { materialFigures } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import type { PageServerLoad } from './$types';

/**
 * One count. Being counted, it is a sheet: every material offered, and any
 * retired one with stock still on the shelf, with what is on hand now and
 * what was counted of each. Applied, it is what was counted, what the shelf
 * said then, and what each adjustment it made moved and was worth.
 *
 * The one being counted is kept for no signal (#lib/offline-copy): its sheet
 * has quantities alone, so it is kept whole.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'no such count');
	const count = await db
		.selectFrom('stock_count as sc')
		.innerJoin('user as starter', 'starter.id', 'sc.created_by')
		.leftJoin('user as applier', 'applier.id', 'sc.applied_by')
		.select([
			'sc.id',
			'sc.counted_on',
			'starter.name as by',
			'sc.applied_at',
			'applier.name as applied_by'
		])
		.where('sc.id', '=', params.id)
		.executeTakeFirst();
	if (!count) error(404, 'no such count');

	const [materials, lines, adjustments] = await Promise.all([
		db
			.selectFrom('material as m')
			.innerJoin('unit as u', 'u.id', 'm.unit_id')
			.select((eb) => [
				'm.id',
				'm.name',
				'm.brand',
				'm.sku',
				// How its unit is written beside a figure: "ft", or the name.
				eb.fn.coalesce('u.short', 'u.name').as('unit'),
				'u.places',
				'm.active'
			])
			.orderBy('m.name')
			.execute(),
		db
			.selectFrom('stock_count_line as l')
			.innerJoin('user as u', 'u.id', 'l.counted_by')
			.select(['l.material_id', 'l.counted', 'l.on_hand', 'l.cost_each', 'u.name as by'])
			.where('l.count_id', '=', count.id)
			.execute(),
		db
			.selectFrom('stock_adjustment as a')
			.select((eb) => [
				'a.material_id',
				'a.way',
				'a.qty',
				sql<string>`(${eb.ref('a.ex_tax_cost')} + ${eb.ref('a.tax_paid')})::text`.as('worth')
			])
			.where('a.count_id', '=', count.id)
			.execute()
	]);
	const counted = new Set(lines.map((l) => l.material_id));
	const figures = await materialFigures(materials.map((m) => m.id));
	const sheet = materials
		.map((m) => ({ ...m, on_hand: figures.of.get(m.id)!.on_hand }))
		.filter((m) => m.active || Number(m.on_hand) > 0 || counted.has(m.id));
	return {
		as_of: new Date().toISOString(),
		count: { ...count, applied_at: count.applied_at?.toISOString() ?? null },
		sheet: count.applied_at ? sheet.filter((m) => counted.has(m.id)) : sheet,
		lines,
		adjustments
	};
};
