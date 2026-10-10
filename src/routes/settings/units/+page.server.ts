import { asc, count, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { material, unit } from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/**
 * What things are counted in: the operator's own list, and how many materials
 * each counts, so a unit nothing uses can be let go.
 */
export const load: PageServerLoad = async () => {
	const units = await db
		.select({
			id: unit.id,
			name: unit.name,
			short: unit.short,
			places: unit.places,
			materials: sql<number>`(${db.select({ n: count() }).from(material).where(eq(material.unitId, unit.id))})::int`
		})
		.from(unit)
		.orderBy(asc(unit.name));
	return { units };
};
