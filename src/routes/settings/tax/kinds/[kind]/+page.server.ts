import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { UUID } from '#lib/field-rules.ts';
import { saleKind } from '#lib/server/sale-kinds.ts';
import type { PageServerLoad } from './$types';

/**
 * A kind of sale (#lib/server/sale-kinds): what it is called and whether it is
 * offered, whether each state the business collects in taxes it, and who
 * said so; the materials and services that are it; and whether it can go.
 */
export const load: PageServerLoad = async ({ params }) => {
	const kind = UUID.test(params.kind) ? await saleKind(db, params.kind) : undefined;
	if (!kind) error(404, 'No such kind of sale.');
	return { kind };
};
