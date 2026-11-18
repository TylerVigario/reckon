import { asUser, db } from '#lib/server/db/index.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { parseAreaField } from '#lib/area-fields.ts';
import { findTypedArea, Refused, removeArea, renameArea } from '#lib/server/typed-areas.ts';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * One typed area (#lib/server/typed-areas). PATCH changes what the state calls
 * it or its code for it, a field at a time; a line already taxed there keeps
 * the name it was billed under. DELETE takes away one typed by mistake, which
 * no site has ever been placed in.
 */
const NOT_FOUND = 'No such area of that state is typed here.';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const area = await findTypedArea(db, params.state, params.area);
	if (!area) return problem('notFound', 404, NOT_FOUND);
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 400, 'Expected { fields: { name: value } }.');
	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 400, 'No fields given.');

	const set: { name?: string; code?: string | null } = {};
	const errors: Record<string, string> = {};
	for (const name of names) {
		const raw = fields[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseAreaField(name, raw === null || raw === undefined ? '' : String(raw));
		if (!parsed.ok) errors[name] = parsed.why;
		else if (name === 'name') set.name = String(parsed.value);
		else set.code = parsed.value === null ? null : String(parsed.value);
	}
	if (Object.keys(errors).length) return refuse(errors);

	try {
		await asUser(locals.user!.id, (tx) => renameArea(tx, area, set));
		return Response.json({ saved: set });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const area = await findTypedArea(db, params.state, params.area);
	if (!area) return problem('notFound', 404, NOT_FOUND);
	try {
		await asUser(locals.user!.id, (tx) => removeArea(tx, area.id));
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof Refused) return problem('conflict', 409, e.message);
		throw e;
	}
};
