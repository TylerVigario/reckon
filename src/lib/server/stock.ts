import { sql, type NumericString } from 'kysely';
import { businessToday } from './calendar.ts';
import { materialWorth } from './valuation/misc.ts';
import { db, type Reader } from './db/index.ts';
import { Decimal } from '../decimal.ts';
import type { Shelf } from '../stock-draw.ts';

/**
 * What each material has on the shelf (#lib/stock-draw): its lots with
 * something left, oldest first, and what all of it is worth -- every lot's cost
 * (a found lot's too) less the cost of every line that drew from them and every
 * take that wrote some off, before tax and in tax.
 *
 * Every material asked about has a shelf, empty when nothing is left. It is
 * read in one statement, so the lots and the worth are of the same moment: a
 * lot received while it is read is in both or in neither. Read in the
 * transaction that draws, after the material's row is locked, it is the shelf
 * as it stands for that draw.
 */
export async function shelves(materialIds: readonly string[], r: Reader = db) {
	const out = new Map<string, Shelf>();
	if (materialIds.length === 0) return out;
	const ids = [...materialIds];
	const rows = await r
		.with('drawn', (qc) =>
			// What every line that drew from them cost, whatever invoice it is on
			// now, and what every take wrote off.
			qc
				.selectFrom((eb) =>
					eb
						.selectFrom('invoice_line as il')
						.select((eb) => [
							'il.material_id',
							eb.fn.coalesce('il.ex_tax_cost', eb.lit(0)).$castTo<NumericString>().as('ex_tax'),
							eb.fn.coalesce('il.tax_paid', eb.lit(0)).$castTo<NumericString>().as('tax')
						])
						.where('il.material_id', '=', (eb) => eb.fn.any(eb.val(ids)))
						.where((eb) =>
							eb.exists(
								eb
									.selectFrom('stock_draw as d')
									.select(eb.lit(1).as('one'))
									.whereRef('d.invoice_line_id', '=', 'il.id')
							)
						)
						.unionAll(
							eb
								.selectFrom('stock_adjustment as sa')
								.select(['sa.material_id', 'sa.ex_tax_cost as ex_tax', 'sa.tax_paid as tax'])
								.where('sa.material_id', '=', (eb) => eb.fn.any(eb.val(ids)))
								.where('sa.way', '=', 'off')
						)
						.as('d')
				)
				.select((eb) => [
					'd.material_id',
					eb.fn.sum<NumericString>('d.ex_tax').as('ex_tax'),
					eb.fn.sum<NumericString>('d.tax').as('tax')
				])
				.groupBy('d.material_id')
		)
		.selectFrom('material_lot as ml')
		.leftJoin('drawn', 'drawn.material_id', 'ml.material_id')
		.select((eb) => {
			const all = (lot: 'ml.ex_tax_cost' | 'ml.tax_paid') =>
				eb.fn.sum(lot).over((ob) => ob.partitionBy('ml.material_id'));
			return [
				'ml.material_id',
				'ml.id',
				'ml.qty_received',
				'ml.qty_remaining',
				'ml.ex_tax_cost',
				'ml.tax_paid',
				sql<NumericString>`${all('ml.ex_tax_cost')} - coalesce(${eb.ref('drawn.ex_tax')}, 0)`.as(
					'ex_tax_worth'
				),
				sql<NumericString>`${all('ml.tax_paid')} - coalesce(${eb.ref('drawn.tax')}, 0)`.as(
					'tax_worth'
				)
			];
		})
		.where('ml.material_id', '=', (eb) => eb.fn.any(eb.val(ids)))
		// Oldest first: the day it arrived, then the order it was entered in.
		.orderBy('ml.received_on')
		.orderBy('ml.id')
		.execute();
	for (const id of ids) {
		const mine = rows.filter((x) => x.material_id === id);
		out.set(id, {
			lots: mine
				.filter((x) => Decimal.from(x.qty_remaining).gt(0))
				.map((x) => ({
					id: x.id,
					qtyReceived: x.qty_received,
					qtyRemaining: x.qty_remaining,
					exTaxCost: x.ex_tax_cost,
					taxPaid: x.tax_paid
				})),
			exTaxWorth: mine[0]?.ex_tax_worth ?? '0',
			taxWorth: mine[0]?.tax_worth ?? '0'
		});
	}
	return out;
}

/**
 * What each material has on the shelf, what one costs before tax and in tax,
 * and what it sells at -- its own price where one is listed today, else that
 * cost and its markup, or the business's -- as the business costs its stock.
 * What the materials list shows of each, and a material's own head.
 */
export async function materialFigures(materialIds: readonly string[]) {
	const ids = [...materialIds];
	const [own, listed, op, onShelf] = await Promise.all([
		db
			.selectFrom('material')
			.select(['id', 'markup_pct'])
			.where('id', '=', (eb) => eb.fn.any(eb.val(ids)))
			.execute(),
		// The newest price listed for each, on or before today.
		db
			.selectFrom('material_price')
			.distinctOn('material_id')
			.select(['material_id', 'price'])
			.where('material_id', '=', (eb) => eb.fn.any(eb.val(ids)))
			.where('effective_from', '<=', businessToday())
			.orderBy('material_id')
			.orderBy('effective_from', 'desc')
			.execute(),
		db
			.selectFrom('operator')
			.select(['default_markup_pct as markup', 'stock_costing as costing'])
			.executeTakeFirst(),
		shelves(materialIds)
	]);
	const costing = op?.costing ?? 'average';
	const priceOf = new Map(listed.map((l) => [l.material_id, l.price]));
	return {
		costing,
		markup: op?.markup ?? null,
		of: new Map(
			own.map((m) => {
				const markup = m.markup_pct ?? op?.markup ?? '0';
				const w = materialWorth(onShelf.get(m.id)!, costing, markup, priceOf.get(m.id) ?? null);
				return [
					m.id,
					{
						markup_pct: markup,
						on_hand: w.onHand.toString(),
						ex_tax: w.exTax?.toString() ?? null,
						tax_paid: w.taxPaid?.toString() ?? null,
						price: w.price?.toString() ?? null,
						// A set price in force today, if it sells at one rather than a markup.
						listed: priceOf.get(m.id) ?? null
					}
				];
			})
		)
	};
}
