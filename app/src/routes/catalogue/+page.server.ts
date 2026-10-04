import { businessToday } from '#lib/server/calendar.ts';
import { and, count, eq, gte, isNull, lte, notExists, or, sql } from 'drizzle-orm';
import { sum } from '#lib/decimal.ts';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** What can go on a line: what is sold, what is stocked, what recurs. */
export const load: PageServerLoad = async () => {
	const running = or(
		isNull(t.agreement.endsOn),
		gte(t.agreement.endsOn, sql`${businessToday()}::date`)
	);
	const onShelf = db
		.select({ n: sql`coalesce(sum(${t.materialLot.qtyRemaining}), 0)` })
		.from(t.materialLot)
		.where(eq(t.materialLot.materialId, t.material.id));

	const [[services], [unpriced], [materials], [outOfStock], agreements] = await Promise.all([
		db.select({ n: count() }).from(t.service).where(eq(t.service.active, true)),
		db
			.select({ n: count() })
			.from(t.service)
			.where(
				and(
					eq(t.service.active, true),
					notExists(
						db
							.select({ x: sql`1` })
							.from(t.servicePrice)
							.where(
								and(
									eq(t.servicePrice.serviceId, t.service.id),
									lte(t.servicePrice.effectiveFrom, sql`${businessToday()}::date`)
								)
							)
					)
				)
			),
		db.select({ n: count() }).from(t.material).where(eq(t.material.active, true)),
		db
			.select({ n: count() })
			.from(t.material)
			.where(and(eq(t.material.active, true), sql`(${onShelf}) <= 0`)),
		db
			.select({ price: t.agreement.price, interval: t.agreement.billingInterval })
			.from(t.agreement)
			.where(running)
	]);

	return {
		counts: {
			services: String(services.n),
			unpriced: String(unpriced.n),
			materials: String(materials.n),
			out_of_stock: String(outOfStock.n),
			agreements: String(agreements.length),
			recurring: sum(
				agreements.filter((a) => a.interval === 'monthly').map((a) => a.price)
			).toString()
		}
	};
};
