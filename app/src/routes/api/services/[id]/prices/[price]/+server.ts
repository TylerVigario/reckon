import { json } from '@sveltejs/kit';
import { and, eq, gte, sql } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { servicePrice } from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Takes back a price that has not yet been in force for a whole day: one
 * scheduled for later, or one entered today by mistake. A price whose day has
 * passed is history, and is changed by a price from another day instead.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.price))
		return problem('notFound', 404, 'No such price.');

	const gone = await asUser(locals.user!.id, (tx) =>
		tx
			.delete(servicePrice)
			.where(
				and(
					eq(servicePrice.id, params.price),
					eq(servicePrice.serviceId, params.id),
					gte(servicePrice.effectiveFrom, sql`current_date`)
				)
			)
			.returning({ id: servicePrice.id })
	);
	if (gone.length === 0)
		return problem(
			'conflict',
			409,
			'That price is not here, or its day has passed. A price that has been in force stays on the history; change it with a price from another day.'
		);
	return json({ removed: params.price });
};
