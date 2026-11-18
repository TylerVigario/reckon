import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { parseFrom, parsePieces } from '#lib/area-fields.ts';
import { findTypedArea, Refused, removeRate, typeRate } from '#lib/server/typed-areas.ts';
import type { State } from '#lib/us-states.ts';
import { problem } from '#lib/server/problem.ts';
import { readJson } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * A typed area's rate from a day (#lib/server/typed-areas). PUT makes
 * { pieces: [{ level, jurisdiction, code, rate_pct }] } its rate from that
 * day -- a new rate, or the one from that day typed again -- and confirms the
 * area. DELETE takes it away: typed wrong, or a change that is not coming. A
 * line already taxed keeps the pieces it was billed at.
 */
const NOT_FOUND = 'No such area of that state is typed here.';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const area = await findTypedArea(db, params.state, params.area);
	if (!area) return problem('notFound', 404, NOT_FOUND);
	const from = parseFrom(params.from);
	if (!from.ok) return refuse({ from: from.why });
	const body = (await readJson(request).catch(() => null)) as { pieces?: unknown } | null;
	if (!body) return problem('malformed', 400, 'Expected { pieces: [...] }.');
	const rate = parsePieces(body.pieces, params.state as State);
	if (Object.keys(rate.errors).length) return refuse(rate.errors);

	try {
		const done = await asUser(locals.user!.id, (tx) =>
			typeRate(tx, area.id, params.from, rate.pieces, locals.user!.id, businessToday())
		);
		return Response.json({ from: params.from }, { status: done === 'typed' ? 201 : 200 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const area = await findTypedArea(db, params.state, params.area);
	if (!area) return problem('notFound', 404, NOT_FOUND);
	const from = parseFrom(params.from);
	if (!from.ok) return problem('notFound', 404, 'No rate from that day.');
	try {
		const gone = await asUser(locals.user!.id, (tx) =>
			removeRate(tx, area.id, params.from, businessToday())
		);
		if (!gone) return problem('notFound', 404, 'No rate from that day.');
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof Refused) return problem('conflict', 409, e.message);
		throw e;
	}
};
