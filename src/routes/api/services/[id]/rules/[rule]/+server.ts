import { businessToday } from '#lib/server/calendar.ts';
import { and, eq, gte, sql } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import { payRule } from '#lib/server/db/schema/index.ts';
import { UUID } from '#lib/field-rules.ts';
import type { RequestHandler } from './$types';
import { problem } from '#lib/server/problem.ts';

/**
 * Takes back a pay rule that has not yet been in force for a whole day. One
 * whose day has passed is history: it paid for work, and is changed by a rule
 * from another day instead.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id) || !UUID.test(params.rule))
		return problem('notFound', 404, 'No such rule.');

	const gone = await asUser(locals.user!.id, (tx) =>
		tx
			.delete(payRule)
			.where(
				and(
					eq(payRule.id, params.rule),
					eq(payRule.serviceId, params.id),
					gte(payRule.effectiveFrom, sql`${businessToday()}::date`)
				)
			)
			.returning({ id: payRule.id })
	);
	if (gone.length === 0)
		return problem(
			'conflict',
			409,
			'That rule is not here, or its day has passed. A rule that has been in force stays on the history; change it with a rule from another day.'
		);
	return Response.json({ removed: params.rule });
};
