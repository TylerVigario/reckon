import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { confirmArea, findTypedArea } from '#lib/server/typed-areas.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/**
 * Confirms a typed area's rate as the state's own table has it today, one
 * action (#lib/server/typed-areas): it is stale again once a quarter begins.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const area = await findTypedArea(db, params.state, params.area);
	if (!area) return problem('notFound', 'No such area of that state is typed here.');
	const today = businessToday();
	await asUser(locals.user!.id, (tx) => confirmArea(tx, area.id, locals.user!.id, today));
	return Response.json({ confirmed_on: today });
};
