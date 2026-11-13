import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * A material's Adjustments tab: every time its stock was put right, by hand
 * or by a count, newest first -- taken off or put on, how much, why, by whom,
 * and what it moved was worth.
 */
export const load: PageServerLoad = async ({ params }) => ({
	adjustments: await db
		.select({
			id: t.stockAdjustment.id,
			made_on: t.stockAdjustment.madeOn,
			way: t.stockAdjustment.way,
			qty: t.stockAdjustment.qty,
			reason: t.stockAdjustment.reason,
			note: t.stockAdjustment.note,
			ex_tax_cost: t.stockAdjustment.exTaxCost,
			tax_paid: t.stockAdjustment.taxPaid,
			count_id: t.stockAdjustment.countId,
			by: t.user.name
		})
		.from(t.stockAdjustment)
		.innerJoin(t.user, eq(t.user.id, t.stockAdjustment.createdBy))
		.where(eq(t.stockAdjustment.materialId, params.id))
		.orderBy(desc(t.stockAdjustment.madeOn), desc(t.stockAdjustment.createdAt))
});
