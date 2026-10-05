import { businessToday } from '#lib/server/calendar.ts';
import { asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { materialWorth } from '#lib/server/valuation/misc.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import type { PageServerLoad } from './$types';

/**
 * Materials: cost and tax stored apart.
 *
 * A lot records what was paid excluding tax, and the tax paid on it, as two
 * figures. Reg 1701 lets the tax already paid on goods that were resold come
 * off the measure -- which is only possible if the two were never added
 * together. Price is the ex-tax cost plus markup, weighted across open lots.
 */
export const load: PageServerLoad = async () => {
	const [materials, lots, listed, [op], places] = await Promise.all([
		db
			.select({
				id: t.material.id,
				name: t.material.name,
				sku: t.material.sku,
				brand: t.material.brand,
				unit: t.material.unit,
				markupPct: t.material.markupPct
			})
			.from(t.material)
			.where(eq(t.material.active, true))
			.orderBy(asc(t.material.name)),
		db
			.select({
				materialId: t.materialLot.materialId,
				supplier: t.materialLot.supplier,
				qtyRemaining: t.materialLot.qtyRemaining,
				exTaxCostPerUnit: t.materialLot.exTaxCostPerUnit,
				taxPaidPerUnit: t.materialLot.taxPaidPerUnit
			})
			.from(t.materialLot)
			.where(gt(t.materialLot.qtyRemaining, '0')),
		// The newest price listed for each, on or before today.
		db
			.selectDistinctOn([t.materialPrice.materialId], {
				materialId: t.materialPrice.materialId,
				price: t.materialPrice.price
			})
			.from(t.materialPrice)
			.where(lte(t.materialPrice.effectiveFrom, sql`${businessToday()}::date`))
			.orderBy(t.materialPrice.materialId, desc(t.materialPrice.effectiveFrom)),
		db.select({ markup: t.operator.defaultMarkupPct }).from(t.operator),
		moneyPlaces()
	]);
	const priceOf = new Map(listed.map((l) => [l.materialId, l.price]));

	return {
		materials: materials.map((m) => {
			const mine = lots.filter((l) => l.materialId === m.id);
			const markup = m.markupPct ?? op?.markup ?? '0';
			const w = materialWorth(mine, markup, priceOf.get(m.id) ?? null, places);
			const suppliers = [...new Set(mine.map((l) => l.supplier).filter((x) => x !== null))];
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
		markup: op?.markup ?? null
	};
};
