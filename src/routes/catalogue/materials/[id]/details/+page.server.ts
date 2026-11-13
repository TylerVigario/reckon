import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import type { PageServerLoad } from './$types';

/** A material's Details tab: the units it could be counted in, besides what its record says. */
export const load: PageServerLoad = async () => ({
	units: await db
		.select({ id: t.unit.id, name: t.unit.name })
		.from(t.unit)
		.orderBy(asc(t.unit.name))
});
