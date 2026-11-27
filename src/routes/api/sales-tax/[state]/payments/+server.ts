import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import { recordPayment, Refused } from '#lib/server/sales-tax.ts';
import { parsePayment } from '#lib/tax-filing-fields.ts';
import { readJson } from '#lib/json.ts';
import { isState, stateName } from '#lib/us-states.ts';
import type { RequestHandler } from './$types';

/**
 * Records a payment to a state (#lib/server/sales-tax): { period_start,
 * period_end, paid_on, tax, penalty_and_interest, reference }, with its
 * period's return, after it, or before it as a prepayment.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!isState(params.state)) return problem('notFound', 404, 'No such state.');
	const body = (await readJson(request).catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object')
		return problem(
			'malformed',
			400,
			'Expected { period_start, period_end, paid_on, tax, penalty_and_interest, reference }.'
		);
	const { value, errors } = parsePayment(body);
	if (!value) return refuse(errors);
	try {
		const id = await recordPayment(locals.user!.id, params.state, value);
		return Response.json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof Refused)
			return e.field === 'state'
				? problem('notFound', 404, `${stateName(params.state)} has no tax to pay.`)
				: refuse({ [e.field]: e.message });
		throw e;
	}
};
