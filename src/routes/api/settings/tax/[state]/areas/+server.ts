import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { AREA_FIELDS, parseFrom, parsePieces } from '#lib/area-fields.ts';
import { parseAll } from '#lib/field-rules.ts';
import { Refused, typeArea, typesAreasIn } from '#lib/server/typed-areas.ts';
import { stateName, type State } from '#lib/us-states.ts';
import { problem } from '#lib/server/problem.ts';
import { readJson } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * Types a new area of a state in from its own table (#lib/server/typed-areas):
 * { fields: { name, code, from }, pieces: [{ level, jurisdiction, code,
 * rate_pct }] } -- what the state calls it, its code for it, and its rate from
 * the day it took effect. Only where the business collects and no authority
 * answers for an address; California's areas are CDTFA's.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!(await typesAreasIn(db, params.state)))
		return problem(
			'notFound',
			404,
			`${stateName(params.state)}'s areas are not typed here: the business does not collect tax there, or its authority places each site.`
		);
	const body = (await readJson(request).catch(() => null)) as {
		fields?: Record<string, unknown>;
		pieces?: unknown;
	} | null;
	if (!body?.fields || typeof body.fields !== 'object')
		return problem('malformed', 400, 'Expected { fields: { name, code, from }, pieces: [...] }.');

	const { values, errors } = parseAll(AREA_FIELDS, body.fields);
	const from = parseFrom(typeof body.fields.from === 'string' ? body.fields.from : '');
	if (!from.ok) errors.from = from.why;
	const rate = parsePieces(body.pieces, params.state as State);
	Object.assign(errors, rate.errors);
	if (Object.keys(errors).length) return refuse(errors);

	try {
		const id = await asUser(locals.user!.id, (tx) =>
			typeArea(
				tx,
				params.state,
				{ name: String(values.name), code: values.code === null ? null : String(values.code) },
				{ from: String(from.ok && from.value), pieces: rate.pieces },
				locals.user!.id,
				businessToday()
			)
		);
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};
