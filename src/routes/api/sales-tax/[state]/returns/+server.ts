import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { recordReturn, Refused } from '#lib/server/sales-tax.ts';
import { parseReturn } from '#lib/tax-filing-fields.ts';
import { readJson } from '#lib/json.ts';
import { isState, stateName } from '#lib/us-states.ts';
import type { RequestHandler } from './$types';

/**
 * Records a return filed with a state (#lib/server/sales-tax): { period_start,
 * period_end, filed_on, tax, kept, paid, reference }, what was paid with it a
 * payment of its own on the day. One for a period filed already is its
 * amended return.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!isState(params.state)) return problem('notFound', 'No such state.');
	const body = (await readJson(request).catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object')
		return problem(
			'malformed',
			'Expected { period_start, period_end, filed_on, tax, kept, paid, reference }.'
		);
	const { value, errors } = parseReturn(body);
	if (!value) return refuse(errors);
	try {
		const id = await recordReturn(locals.user!.id, params.state, value);
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof Refused)
			return e.field === 'state'
				? problem('notFound', `${stateName(params.state)} has no tax to file for.`)
				: refuse({ [e.field]: e.message });
		throw e;
	}
};
