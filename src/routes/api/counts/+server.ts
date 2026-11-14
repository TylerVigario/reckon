import { and, eq, isNull } from 'drizzle-orm';
import { asUser, db } from '#lib/server/db/index.ts';
import * as t from '#lib/server/db/schema/index.ts';
import { personalToday } from '#lib/server/calendar.ts';
import { pgError, refuse } from '#lib/server/field-errors.ts';
import { madeAt } from '#lib/server/made-at.ts';
import { UUID, isoDate } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
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
 * Starts a count, or answers with the one already open: one is counted at a
 * time, which anyone counting adds to (stock_count_one_open).
 *
 * From the page or a phone's queue (#lib/queue), with the uuid it was started
 * with and, from a phone, the day it was counted there: one started twice is
 * one, and one started on a phone while another was opened elsewhere joins
 * that one, so what was counted on both is one count.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await readBody(request)) ?? {};
	const clientUuid = typeof body.client_uuid === 'string' ? body.client_uuid : '';
	if (!UUID.test(clientUuid)) return refuse({ client_uuid: 'The uuid it was started with.' });
	const userId = locals.user!.id;
	const [mine] = await db
		.select({ id: t.stockCount.id })
		.from(t.stockCount)
		.where(and(eq(t.stockCount.createdBy, userId), eq(t.stockCount.clientUuid, clientUuid)));
	if (mine) return Response.json({ id: mine.id });
	const had = await open();
	if (had) return Response.json({ id: had });
	// The day it was counted, where a phone says one: never after today.
	const said = typeof body.counted_on === 'string' ? isoDate(body.counted_on) : null;
	const today = personalToday();
	const on = said?.ok && String(said.value) <= today ? String(said.value) : today;
	try {
		const [made] = await asUser(
			userId,
			(tx) =>
				tx
					.insert(t.stockCount)
					.values({ countedOn: on, clientUuid, createdBy: userId })
					.returning({ id: t.stockCount.id }),
			madeAt(typeof body.made_at === 'string' ? body.made_at : '')
		);
		return Response.json({ id: made.id }, { status: 201 });
	} catch (e) {
		// Started by someone else in the same moment: theirs is the one.
		if (pgError(e).constraint === 'stock_count_one_open')
			return Response.json({ id: await open() });
		throw e;
	}
};
