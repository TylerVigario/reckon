import { isNull } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { pgError } from '#lib/server/field-errors.ts';
import type { RequestHandler } from './$types';

/** The count being counted, if one is. */
const open = async () =>
	(
		await db
			.select({ id: t.stockCount.id })
			.from(t.stockCount)
			.where(isNull(t.stockCount.appliedAt))
	)[0]?.id ?? null;

/**
 * Starts a count, today, or answers with the one already open: one is counted
 * at a time, which anyone counting adds to (stock_count_one_open).
 */
export const POST: RequestHandler = async ({ locals }) => {
	const had = await open();
	if (had) return Response.json({ id: had });
	try {
		const [made] = await asUser(locals.user!.id, (tx) =>
			tx
				.insert(t.stockCount)
				.values({ countedOn: personalToday(), createdBy: locals.user!.id })
				.returning({ id: t.stockCount.id })
		);
		return Response.json({ id: made.id }, { status: 201 });
	} catch (e) {
		// Started by someone else in the same moment: theirs is the one.
		if (pgError(e).constraint === 'stock_count_one_open')
			return Response.json({ id: await open() });
		throw e;
	}
};
