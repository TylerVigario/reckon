import { eq } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { shelves } from '#lib/server/stock.ts';
import { UUID } from '#lib/field-rules.ts';
import { readFields } from '#lib/json.ts';
import { readAdjustment } from '#lib/adjust-fields.ts';
import { drawFrom, unitCost } from '#lib/stock-draw.ts';
import { Decimal, Ratio } from '#lib/decimal.ts';
import { quantity } from '#lib/format.ts';
import type { RequestHandler } from './$types';

/** Thrown inside the transaction to refuse with what the shelf said. */
class Refused extends Error {
	constructor(readonly response: Response) {
		super('refused');
	}
}

/**
 * Stock put right by hand (#lib/adjust-fields): so much of one material taken
 * off the shelf, or put on it, on a day, for a reason.
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
 *
 * The material's row is locked first, as a line's draw locks it, so two
 * adjustments or an adjustment and a draw are made one after the other.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No material with that id.');
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');

	const [m] = await db
		.select({
			id: t.material.id,
			name: t.material.name,
			places: t.unit.places,
			short: t.unit.short,
			unit: t.unit.name
		})
		.from(t.material)
		.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
		.where(eq(t.material.id, params.id));
	if (!m) return problem('notFound', 404, 'No material with that id.');

	const { values, errors } = readAdjustment(fields, m.places);
	if (typeof values.made_on === 'string' && values.made_on > personalToday())
		errors.made_on = 'It cannot be put right before it happens.';
	if (Object.keys(errors).length > 0) return refuse(errors);

	const [op] = await db.select({ costing: t.operator.stockCosting }).from(t.operator);
	const costing = op?.costing ?? 'average';
	const qty = String(values.qty);
	const unit = m.short ?? m.unit;
	try {
		const id = await asUser(locals.user!.id, async (tx) => {
			await tx
				.select({ id: t.material.id })
				.from(t.material)
				.where(eq(t.material.id, m.id))
				.for('no key update');
			const shelf = (await shelves([m.id], tx)).get(m.id)!;
			const row = {
				materialId: m.id,
				madeOn: String(values.made_on),
				way: values.way as 'off' | 'on',
				qty,
				reason: values.reason as 'used',
				note: values.note === null ? null : String(values.note),
				createdBy: locals.user!.id
			};
			if (values.way === 'off') {
				const draw = drawFrom(shelf, qty, costing);
				if ('short' in draw)
					throw new Refused(
						refuse({
							qty: draw.short.isZero()
								? `None of ${m.name} is on the shelf.`
								: `Only ${quantity(draw.short.toString())} ${unit} of ${m.name} is on the shelf.`
						})
					);
				const [made] = await tx
					.insert(t.stockAdjustment)
					.values({
						...row,
						exTaxCost: draw.exTaxCost.toString(),
						taxPaid: draw.taxPaid.toString()
					})
					.returning({ id: t.stockAdjustment.id });
				await tx.insert(t.stockTake).values(
					draw.takes.map((take) => ({
						adjustmentId: made.id,
						materialLotId: take.lotId,
						materialId: m.id,
						qty: take.qty.toString()
					}))
				);
				return made.id;
			}
			// A find, at what one is worth on the shelf now, or what one cost as said.
			const now = unitCost(shelf, costing);
			const each =
				values.cost_each !== null
					? { exTax: Decimal.from(String(values.cost_each)), taxPaid: Decimal.ZERO }
					: now;
			if (!each)
				throw new Refused(
					refuse({
						cost_each: `Nothing of ${m.name} is on the shelf to cost it by: say what one cost.`
					})
				);
			const exTax = Ratio.of(each.exTax).mul(qty).round(4);
			const tax = Ratio.of(each.taxPaid).mul(qty).round(4);
			const [made] = await tx
				.insert(t.stockAdjustment)
				.values({ ...row, exTaxCost: exTax.toString(), taxPaid: tax.toString() })
				.returning({ id: t.stockAdjustment.id });
			await tx.insert(t.materialLot).values({
				adjustmentId: made.id,
				materialId: m.id,
				receivedOn: String(values.made_on),
				qtyReceived: qty,
				qtyRemaining: qty,
				exTaxCost: exTax.toString(),
				taxPaid: tax.toString()
			});
			return made.id;
		});
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof Refused) return e.response;
		throw e;
	}
};
