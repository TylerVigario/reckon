import { inArray, sql } from 'drizzle-orm';
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
