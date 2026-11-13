import { and, eq, isNull } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { problem } from '#lib/server/problem.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';

/**
 * Throws away a count still being counted, and what was counted on it. One
 * applied stays as it was: what it put right names it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No count with that id.');
	const gone = await asUser(locals.user!.id, (tx) =>
		tx
			.delete(t.stockCount)
			.where(and(eq(t.stockCount.id, params.id), isNull(t.stockCount.appliedAt)))
			.returning({ id: t.stockCount.id })
	);
	if (gone.length === 0)
		return problem('conflict', 409, 'That count has been applied, or is gone already.');
	return new Response(null, { status: 204 });
};
