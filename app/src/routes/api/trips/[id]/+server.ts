import { eq } from 'drizzle-orm';
import { asUser } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { stillReferenced } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/**
 * Removes a trip recorded wrongly, with its stops and legs. One whose miles are
 * on an invoice stays: the schema refuses to take a billed line's leg from it.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.id)) return problem('notFound', 404, 'No trip with that id.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			tx.delete(t.trip).where(eq(t.trip.id, params.id)).returning({ id: t.trip.id })
		);
		if (gone.length === 0) return problem('notFound', 404, 'No trip with that id.');
	} catch (e) {
		if (stillReferenced(e))
			return problem('conflict', 409, 'Its miles are on an invoice, so it stays as it was.');
		throw e;
	}
	return Response.json({ removed: params.id });
};
