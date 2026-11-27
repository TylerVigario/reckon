import { asUser, db } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { parseAll } from '#lib/field-rules.ts';
import { KIND_FIELDS, parseAnswers } from '#lib/kind-fields.ts';
import { addKind, Refused } from '#lib/server/sale-kinds.ts';
import { collecting } from '#lib/server/tax-registrations.ts';
import { stateName } from '#lib/us-states.ts';
import { problem } from '#lib/server/problem.ts';
import { readJson } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * Adds a kind of sale of the business's own (#lib/server/sale-kinds), with
 * whether each state it collects in taxes it: { fields: { name }, taxed: {
 * [state]: true | false } }, one answer for every state, none assumed.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await readJson(request).catch(() => null)) as {
		fields?: Record<string, unknown>;
		taxed?: unknown;
	} | null;
	if (!body?.fields || typeof body.fields !== 'object')
		return problem('malformed', 'Expected { fields: { name }, taxed: { [state]: true } }.');

	const { values, errors } = parseAll({ name: KIND_FIELDS.name }, body.fields);
	const states = await collecting(db);
	const said = parseAnswers(body.taxed, states, (s) => `Whether ${stateName(s)} taxes it.`);
	Object.assign(errors, said.errors);
	if (Object.keys(errors).length) return refuse(errors);

	try {
		const id = await asUser(locals.user!.id, (tx) =>
			addKind(tx, String(values.name), said.answers, locals.user!.id, businessToday())
		);
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof Refused) return refuse({ [e.field]: e.message });
		throw e;
	}
};
