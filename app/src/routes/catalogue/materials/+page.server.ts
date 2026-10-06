import { businessToday } from '#lib/server/calendar.ts';
import { and, asc, desc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { materialWorth } from '#lib/server/valuation/misc.ts';
import { shelves } from '#lib/server/stock.ts';
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
export const load: PageServerLoad = async () => {
	const [materials, listed, [op]] = await Promise.all([
		db
			.select({
				id: t.material.id,
				name: t.material.name,
				sku: t.material.sku,
				brand: t.material.brand,
				// How its unit is written beside a figure: "ft", or the name.
				unit: sql<string>`coalesce(${t.unit.short}, ${t.unit.name})`,
				markupPct: t.material.markupPct
			})
			.from(t.material)
			.innerJoin(t.unit, eq(t.unit.id, t.material.unitId))
			.where(eq(t.material.active, true))
			.orderBy(asc(t.material.name)),
		// The newest price listed for each, on or before today.
		db
			.selectDistinctOn([t.materialPrice.materialId], {
				materialId: t.materialPrice.materialId,
				price: t.materialPrice.price
			})
			.from(t.materialPrice)
			.where(lte(t.materialPrice.effectiveFrom, sql`${businessToday()}::date`))
			.orderBy(t.materialPrice.materialId, desc(t.materialPrice.effectiveFrom)),
		db
			.select({ markup: t.operator.defaultMarkupPct, costing: t.operator.stockCosting })
			.from(t.operator)
	]);
	const priceOf = new Map(listed.map((l) => [l.materialId, l.price]));
	const costing = op?.costing ?? 'average';
	const [onShelf, suppliersOf] = await Promise.all([
		shelves(materials.map((m) => m.id)),
		// Who the stock on the shelf came from.
		db
			.selectDistinct({ materialId: t.materialLot.materialId, supplier: t.materialLot.supplier })
			.from(t.materialLot)
			.where(and(gt(t.materialLot.qtyRemaining, '0'), isNotNull(t.materialLot.supplier)))
			.orderBy(asc(t.materialLot.supplier))
	]);

	return {
		materials: materials.map((m) => {
			const markup = m.markupPct ?? op?.markup ?? '0';
			const w = materialWorth(onShelf.get(m.id)!, costing, markup, priceOf.get(m.id) ?? null);
			const suppliers = suppliersOf.filter((x) => x.materialId === m.id).map((x) => x.supplier);
			return {
				id: m.id,
				name: m.name,
				sku: m.sku,
				brand: m.brand,
				unit: m.unit,
				markup_pct: markup,
				on_hand: w.onHand.toString(),
				ex_tax: w.exTax?.toString() ?? null,
				tax_paid: w.taxPaid?.toString() ?? null,
				price: w.price?.toString() ?? null,
				suppliers: suppliers.length ? suppliers.join(', ') : null
			};
		}),
		markup: op?.markup ?? null,
		costing
	};
};
