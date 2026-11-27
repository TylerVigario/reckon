import { asUser } from '#lib/server/db/index.ts';
import { businessToday } from '#lib/server/calendar.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { UUID } from '#lib/field-rules.ts';
import { parseAnswerField } from '#lib/kind-fields.ts';
import { answer } from '#lib/server/sale-kinds.ts';
import { stateName } from '#lib/us-states.ts';
import { problem } from '#lib/server/problem.ts';
import { readFields } from '#lib/json.ts';
import type { RequestHandler } from './$types';

/**
 * Whether a state the business collects in taxes a kind of sale
 * (#lib/server/sale-kinds): PATCH { fields: { taxed } }, as the state's page
 * and the kind's save it. Who said it, and when, is kept with it. Lines
 * already on a draft keep their tax until they are changed.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const fields = await readFields(request);
	if (!fields) return problem('malformed', 'Expected { fields: { taxed } }.');
	const raw = fields.taxed;
	const parsed = parseAnswerField('taxed', typeof raw === 'string' ? raw : '');
	if (!parsed.ok) return refuse({ taxed: parsed.why });
	const saved = UUID.test(params.kind)
		? await asUser(locals.user!.id, (tx) =>
				answer(
					tx,
					params.state,
					params.kind,
					parsed.value === true,
					locals.user!.id,
					businessToday()
				)
			)
		: undefined;
	if (!saved)
		return problem(
			'notFound',
			`The business does not collect tax in ${stateName(params.state)}, or there is no such kind of sale.`
		);
	return Response.json({ saved: { taxed: String(saved.taxed) } });
};
