import { asUser } from '#lib/server/db/index.ts';
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
			.deleteFrom('stock_count')
			.where('id', '=', params.id)
			.where('applied_at', 'is', null)
			.returning('id')
			.execute()
	);
	if (gone.length === 0)
		return problem('conflict', 409, 'That count has been applied, or is gone already.');
	return new Response(null, { status: 204 });
};
