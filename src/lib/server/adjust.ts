import type { Tx } from '#lib/server/db/index.ts';
import type { AdjustReason, AdjustWay } from '#lib/adjust-fields.ts';
import { drawFrom, unitCost, type Costing, type Shelf } from '#lib/stock-draw.ts';
import { Decimal, Ratio } from '#lib/decimal.ts';
import { quantity } from '#lib/format.ts';

/** Why an adjustment could not be made, said of the field a person can change. */
export class ShelfRefused extends Error {
	constructor(
		readonly field: 'qty' | 'cost_each',
		readonly why: string
	) {
		super(why);
	}
}

/**
 * ONE MATERIAL'S STOCK PUT RIGHT, inside a transaction that has locked the
 * material's row and read its shelf: by hand, or by a count (countId).
 *
 * A TAKE comes off the oldest lots first and is held at what it cost, costed
 * as the business costs its stock (#lib/stock-draw drawFrom) -- what a line
 * drawing the same would have cost -- so the shelf's worth goes down by what
 * was written off. More than the shelf holds is refused.
 *
 * A FIND is a lot of its own, at what one on the shelf is worth now, before
 * tax and in tax -- what ERPNext fills a blank rate in with -- or at a cost
 * each said, where the shelf has nothing to go by. Either way the shelf's
 * average is not moved by stock that turned up.
 */
export async function putRight(
	tx: Tx,
	a: {
		material: { id: string; name: string; unit: string };
		shelf: Shelf;
		costing: Costing;
		way: AdjustWay;
		qty: string;
		madeOn: string;
		reason: AdjustReason;
		note: string | null;
		costEach: string | null;
		countId?: string | null;
		/** The uuid it was made with, on the page or a phone. */
		clientUuid?: string | null;
		userId: string;
	}
): Promise<string> {
	const m = a.material;
	const row = {
		material_id: m.id,
		made_on: a.madeOn,
		way: a.way,
		qty: a.qty,
		reason: a.reason,
		note: a.note,
		count_id: a.countId ?? null,
		client_uuid: a.clientUuid ?? null,
		created_by: a.userId
	};
	if (a.way === 'off') {
		const draw = drawFrom(a.shelf, a.qty, a.costing);
		if ('short' in draw)
			throw new ShelfRefused(
				'qty',
				draw.short.isZero()
					? `None of ${m.name} is on the shelf.`
					: `Only ${quantity(draw.short.toString())} ${m.unit} of ${m.name} is on the shelf.`
			);
		const made = await tx
			.insertInto('stock_adjustment')
			.values({
				...row,
				ex_tax_cost: draw.exTaxCost.toString(),
				tax_paid: draw.taxPaid.toString()
			})
			.returning('id')
			.executeTakeFirstOrThrow();
		await tx
			.insertInto('stock_take')
			.values(
				draw.takes.map((take) => ({
					adjustment_id: made.id,
					material_lot_id: take.lotId,
					material_id: m.id,
					qty: take.qty.toString()
				}))
			)
			.execute();
		return made.id;
	}
	// A find, at what one is worth on the shelf now, or what one cost as said.
	const each =
		a.costEach !== null
			? { exTax: Decimal.from(a.costEach), taxPaid: Decimal.ZERO }
			: unitCost(a.shelf, a.costing);
	if (!each)
		throw new ShelfRefused(
			'cost_each',
			`Nothing of ${m.name} is on the shelf to cost it by: say what one cost.`
		);
	const exTax = Ratio.of(each.exTax).mul(a.qty).round(4);
	const tax = Ratio.of(each.taxPaid).mul(a.qty).round(4);
	const made = await tx
		.insertInto('stock_adjustment')
		.values({ ...row, ex_tax_cost: exTax.toString(), tax_paid: tax.toString() })
		.returning('id')
		.executeTakeFirstOrThrow();
	await tx
		.insertInto('material_lot')
		.values({
			adjustment_id: made.id,
			material_id: m.id,
			received_on: a.madeOn,
			qty_received: a.qty,
			qty_remaining: a.qty,
			ex_tax_cost: exTax.toString(),
			tax_paid: tax.toString()
		})
		.execute();
	return made.id;
}

/** Locks materials' rows, in one order, as a line's draw locks them. */
export async function lockMaterials(tx: Tx, ids: readonly string[]) {
	for (const id of [...ids].sort())
		await tx.selectFrom('material').select('id').where('id', '=', id).forNoKeyUpdate().execute();
}
