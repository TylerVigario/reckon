import { asUser } from '#lib/server/db/index.ts';
import { type Errors, refuse } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { parseKindField } from '#lib/kind-fields.ts';
import { changeKind, Refused, removeKind } from '#lib/server/sale-kinds.ts';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * A kind of sale (#lib/server/sale-kinds). PATCH renames it, or retires it or
 * offers it again, a field at a time, as its page saves it; DELETE takes away
 * one of the business's own that nothing is or was sold as, and its answers
 * with it. reckon's own kinds stay.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!UUID.test(params.kind)) return problem('notFound', 'No such kind of sale.');
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 'Expected { fields: { name: value } }.');
	const names = Object.keys(fields);
	if (names.length === 0) return problem('malformed', 'No fields given.');

	const row: { name?: string; active?: boolean } = {};
	const errors: Errors = {};
	for (const name of names) {
		const raw = fields[name];
		if (raw !== null && raw !== undefined && typeof raw !== 'string') {
			errors[name] = 'Expected a value, not a structure.';
			continue;
		}
		const parsed = parseKindField(name, raw ?? '');
		if (parsed.ok) Object.assign(row, { [name]: parsed.value });
		else errors[name] = parsed.why;
	}
	if (Object.keys(errors).length) return refuse(errors);

	try {
		const saved = await asUser(locals.user!.id, (tx) => changeKind(tx, params.kind, row));
		if (!saved) return problem('notFound', 'No such kind of sale.');
		return Response.json({ saved });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!UUID.test(params.kind)) return problem('notFound', 'No such kind of sale.');
	try {
		const gone = await asUser(locals.user!.id, (tx) => removeKind(tx, params.kind));
		if (!gone) return problem('notFound', 'No such kind of sale.');
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof Refused) return problem('notAsThingsStand', e.message);
		throw e;
	}
};
