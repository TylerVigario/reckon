import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { moneyPlaces } from '#lib/server/business.ts';
import type { PageServerLoad } from './$types';

/**
 * Stock received, as a receipt or invoice says it: printed once, from whom,
 * the day, its number, who paid, the tax and the paper itself; and each item
 * on it, which becomes a lot with its share of the tax (#lib/server/receive).
 *
 * Everything the form needs to say what each item cost and sells at as it is
 * typed, with no signal: the receipt is written on the phone and sent by the
 * queue (#lib/queue) to /api/receipts, so there is no form action. Kept whole
 * for no signal, as a form is (#lib/offline-copy).
 */
export const load: PageServerLoad = async ({ url }) => {
	const [materials, units, people, [op], places] = await Promise.all([
		db
			.select({
				id: t.material.id,
				name: t.material.name,
				unit_id: t.material.unitId,
				markup_pct: t.material.markupPct
			})
			.from(t.material)
			.where(eq(t.material.active, true))
			.orderBy(asc(t.material.name)),
		db
			.select({ id: t.unit.id, name: t.unit.name, short: t.unit.short, places: t.unit.places })
			.from(t.unit)
			.orderBy(asc(t.unit.name)),
		db
			.select({ id: t.user.id, name: t.user.name })
			.from(t.user)
			.where(eq(t.user.active, true))
			.orderBy(asc(t.user.name)),
		db.select({ markup: t.operator.defaultMarkupPct }).from(t.operator),
		moneyPlaces()
	]);
	const asked = url.searchParams.get('material');
	return {
		as_of: new Date().toISOString(),
		materials,
		units,
		people,
		markup: op?.markup ?? '0',
		today: personalToday(),
		// What an item's cost is rounded to, as the server rounds it.
		places,
		material: asked && materials.some((m) => m.id === asked) ? asked : null
	};
};
