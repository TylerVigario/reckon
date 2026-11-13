import { and, desc, inArray, lte, sql } from 'drizzle-orm';
import { businessToday } from './calendar.ts';
import { materialWorth } from './valuation/misc.ts';
import { db, type Reader } from './db/index.ts';
import * as t from './db/schema/index.ts';
import { Decimal } from '../decimal.ts';
import type { Shelf } from '../stock-draw.ts';

/**
 * What each material has on the shelf (#lib/stock-draw): its lots with
 * something left, oldest first, and what all of it is worth -- every lot's cost
 * less the cost of every line that drew from them, before tax and in tax.
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
	const ml = t.materialLot;
	const il = t.invoiceLine;
	const ids = [...materialIds];
	const { rows } = await r.execute<{
		material_id: string;
		id: string;
		qty_received: string;
		qty_remaining: string;
		ex_tax_cost: string;
		tax_paid: string;
		ex_tax_worth: string;
		tax_worth: string;
	}>(sql`
		with drawn as (
			-- What every line that drew from them cost, whatever invoice it is on now.
			select ${il.materialId} as material_id,
			       sum(coalesce(${il.exTaxCost}, 0)) as ex_tax,
			       sum(coalesce(${il.taxPaid}, 0)) as tax
			  from ${il}
			 where ${inArray(il.materialId, ids)}
			   and exists (select 1 from ${t.stockDraw} d where d.invoice_line_id = ${il.id})
			 group by 1
		)
		select ${ml.materialId} as material_id, ${ml.id} as id,
		       ${ml.qtyReceived}::text as qty_received, ${ml.qtyRemaining}::text as qty_remaining,
		       ${ml.exTaxCost}::text as ex_tax_cost, ${ml.taxPaid}::text as tax_paid,
		       (sum(${ml.exTaxCost}) over w - coalesce(drawn.ex_tax, 0))::text as ex_tax_worth,
		       (sum(${ml.taxPaid}) over w - coalesce(drawn.tax, 0))::text as tax_worth
		  from ${ml}
		  left join drawn on drawn.material_id = ${ml.materialId}
		 where ${inArray(ml.materialId, ids)}
		window w as (partition by ${ml.materialId})
		 -- Oldest first: the day it arrived, then the order it was entered in.
		 order by ${ml.receivedOn}, ${ml.id}`);
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
	const [own, listed, [op], onShelf] = await Promise.all([
		db
			.select({ id: t.material.id, markupPct: t.material.markupPct })
			.from(t.material)
			.where(inArray(t.material.id, [...materialIds])),
		// The newest price listed for each, on or before today.
		db
			.selectDistinctOn([t.materialPrice.materialId], {
				materialId: t.materialPrice.materialId,
				price: t.materialPrice.price
			})
			.from(t.materialPrice)
			.where(
				and(
					inArray(t.materialPrice.materialId, [...materialIds]),
					lte(t.materialPrice.effectiveFrom, sql`${businessToday()}::date`)
				)
			)
			.orderBy(t.materialPrice.materialId, desc(t.materialPrice.effectiveFrom)),
		db
			.select({ markup: t.operator.defaultMarkupPct, costing: t.operator.stockCosting })
			.from(t.operator),
		shelves(materialIds)
	]);
	const costing = op?.costing ?? 'average';
	const priceOf = new Map(listed.map((l) => [l.materialId, l.price]));
	return {
		costing,
		markup: op?.markup ?? null,
		of: new Map(
			own.map((m) => {
				const markup = m.markupPct ?? op?.markup ?? '0';
				const w = materialWorth(onShelf.get(m.id)!, costing, markup, priceOf.get(m.id) ?? null);
				return [
					m.id,
					{
						markup_pct: markup,
						on_hand: w.onHand.toString(),
						ex_tax: w.exTax?.toString() ?? null,
						tax_paid: w.taxPaid?.toString() ?? null,
						price: w.price?.toString() ?? null
					}
				];
			})
		)
	};
}
