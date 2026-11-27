import { problem } from '#lib/server/problem.ts';
import { removePayment } from '#lib/server/sales-tax.ts';
import { UUID } from '#lib/field-rules.ts';
import { isState } from '#lib/us-states.ts';
import type { RequestHandler } from './$types';

/** Takes off a payment recorded by mistake (#lib/server/sales-tax): its history keeps what it was. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!isState(params.state) || !UUID.test(params.id))
		return problem('notFound', 404, 'No such payment.');
	const gone = await removePayment(locals.user!.id, params.state, params.id);
	if (!gone) return problem('notFound', 404, 'No such payment.');
	return new Response(null, { status: 204 });
};
